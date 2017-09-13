define([
  "dojo/_base/declare",
  "dojo/_base/lang",
  "dojo/_base/array",
  "dojo/dom-construct",
  "dojo/dom-style",
  "dojox/gfx/fx",
  "dojo/on",

  "esri/dijit/PopupTemplate",
  "esri/dijit/Popup"
], function (
  declare, lang, arrayUtils, domConstruct, domStyle, fx, on, PopupTemplate, Popup
) {
    return declare([Popup], {
        constructor: function (options) {
            /* options description:
               Existing Popup options can be passed as per normal in the options object
               The 'extended' property on options contains explicit options for PopupExtended. These are explained below. 
               themeClass (string): default null. Set a theme class to be applied to the standard popup. A custom one or 'light', 'dark' etc. Can also be set on a PopupTemplate. 
                                    Features that have PopupTemplates containing this value will override the value passed to this construtor.
               actions ([object, object, ...]): default null. An array of action objects to add to the actions bar in the popup.
                                    An action object contains the following properties:
                                    { 
                                     text: (string) The text of the link, 
                                     className: (string) a custom class to apply to an action, 
                                     title: (string) a title attribute value to add to the link, 
                                     click: (function) This is called when the action is clicked. Will pass the current feature back as a paramter to the callback,
                                     condition: (function) If this is defined the action will only appear if this function evaluates to true. Use it to conditionally apply actions to certain features. Will pass the current feature as a paramter to the callback,
                                    }
                                    Can also be set on a PopupTemplate. Templates containing this value will override the value passed to this construtor.
               scaleSelected (number): default null. If this is set to a value the selected feature will scale in size by the value. 1 = same size, 1.5 = grow 50%, 2 = grow 100%...etc. A bit experimental, think it's a bit buggy only useful for point geometries as well.  
                                    Can also be set on a PopupTemplate. Templates containing this value will override the value passed to this construtor.
               draggable (boolean): default false. Will make the popup draggable by dragging on the title bar. Once dragged (unsnapped from anchor) it will also be resizable.
               defaultWidth (number): default null. The width in pixels to set a popup to when first shown
               multiple (boolean): default false. If multiple popups can be opened at once.
               hideOnOffClick (boolean): default false. Whether to hide all popups when a click occurs that is not on the layer. If false then the close button will have to be used.
               smallStyleWidthBreak (number): default 768. The width to use small popups if the map width is less than.

            */

            options = options || {};
            options.extended = options.extended || {};

            //set the extended properties
            this.themeClass = options.extended.themeClass;
            this.actions = options.extended.actions;
            this.scaleSelected = options.extended.scaleSelected;

            //this.draggable = options.extended.draggable === false;
            this.defaultWidth = options.extended.defaultWidth;
            this.multiple = options.extended.multiple === true;
            this.hideOnOffClick = options.extended.hideOnOffClick === true;
            this.smallStyleWidthBreak = options.extended.smallStyleWidthBreak || 768;

            delete options.extended;

            //clear some properties on this object
            this.highlight = false;
            this.markerSymbol = null;

            //init some values
            this.options = lang.clone(options);
            this.openPopups = [];

            this.popupMode = "normal";
            this.events = [];
        },

        //#region override some of the popups public methods

        setMap: function (map) {
            this.map = map;

            //wire up some events
            this.events.push(on(this.map, "resize", lang.hitch(this, this._setPopupMode)));
            this.events.push(on(this.map, "pan-end", lang.hitch(this, this._mapPanEnd)));

         /*   //if draggable, wire up mouse events on the map and it's node
            if (this.draggable) {
                this.events.push(on(this.map.root, "mousemove", lang.hitch(this, this._mapMouseMove)));
                this.events.push(on(this.map.root, "mouseup", lang.hitch(this, this._mapMouseUp)));
            }

		*/
            this._setPopupMode();
            dojo.destroy(this.domNode);
            return this.inherited(arguments);
        },

        unsetMap: function (map) {
            for (var i = 0, len = this.events.length; i < len; i++) {
                if (this.events[i]) {
                    this.events[i].remove();
                }
            }
            dojo.destroy(this.domNode);
        },

        _mapPanEnd: function (e) {
            //reposition all open popups after a pan
            for (var i = 0, len = this.openPopups.length; i < len; i++) {
                if (this.openPopups[i].isSnapped) {
                    this.openPopups[i].reposition();
                }
            }
        },

        show: function (location, options) {

            for (var i = 0, len = this.openPopups.length; i < len; i++) {
                //check if having multiple open at once is allowed, if not close any open ones down.
                //Also check if the features for the popup to open match any open popups already, if they do, close the open popup so a new one resnaps to the point. Catering for draggable.
                if (!this.multiple || this._featureArraysMatch(this.openPopups[i].features, this.features)) {
                    this.openPopups[i].hide();
                    len--;
                    i--;
                    break;
                }
            }

            //for small style popups, force the title to not be in the body
            if (this.popupMode === "small") {
                this.options.titleInBody = false;
            }

            var popup = new Popup(this.options, dojo.create("div"));

            popup.setFeatures(this.features);
            popup.setMap(this.map);
            popup.index = this.openPopups.length;
            popup.popupEvents = [];
            popup.wrapperNode = popup._positioner;

            this.events.push(on(popup, "show", dojo.partial(this._popupShown, this)));
            this.events.push(on(popup, "hide", dojo.partial(this._popupHidden, this)));
            this.openPopups.push(popup);

            popup.domNode.style.opacity = 0;
            popup.show(location, options);
           
            //this.clearFeatures();
        },


	     resize: function (width, height, feature) {
            //If a feature is passed in this method will only resize the popup where this feature is the currently selected.
            //If a feature is not provided it will resize all open popups

            if (feature) {
                this._callPopupApiMethodsFromFeature(feature, "resize", arguments);
            }
            else {
                for (var i = 0, len = this.openPopups.length; i < len; i++) {
                    this.openPopups[i].resize(width, height);
                }
            }
        },


        set: function (name, value, feature) {
            this._callPopupApiMethodsFromFeature(feature, "set", arguments);
        },

        setContent: function (content, feature) {
            //to explicity call this, must pass in a feature, even if only one popup is open
            if (feature) {
                this._callPopupApiMethodsFromFeature(feature, "setContent", arguments);
            }
            else {
                this.inherited(arguments);
            }
        },

        setTitle: function (title, feature) {
            //to explicity call this, must pass in a feature, even if only one popup is open
            if (feature) {
                this._callPopupApiMethodsFromFeature(feature, "setTitle", arguments);
            }
            else {
                this.inherited(arguments);
            }
        },

        _callPopupApiMethodsFromFeature: function (feature, method, arguments) {
            //this method runs api methods against indiviudal popups. The popup is found by either being the only one open
            //or by the fact the feature being passed in is the selected feature of the popup
            var pu = this.openPopups.length === 1 ? this.openPopups[0] : this.getPopupForFeature(feature);
            if (pu) {
                return pu[method].apply(pu, arguments);
            }

        },


        //#endregion

        //#region extra api methods

        getPopupForFeature: function (feature) {
            //Search all open popups and return the popup object for the one that contains the passed in feature as the currently selected feature.
            //returns null if none found
            for (var i = 0, len = this.openPopups.length; i < len; i++) {
                var selectedFeature = this.openPopups[i].getSelectedFeature();
                if (selectedFeature === feature) {
                    return this.openPopups[i];
                }
            }
            return null;
        },

        //#endregion



        //#region individual popup event implementations

        _popupShown: function (self) {
            //scope: 'self' is the class, 'this' is the child popup that is opened.
            //console.log('shown');

            self._addTemplateOptions(this);

            if (self.options.defaultWidth) {
                //set the default width using resize if one was set in options
                var height = domStyle.get(this.wrapperNode, "height"); //retain the height
                this.resize(self.options.defaultWidth, height);
            }

            this.isSnapped = true; //set is Snapped to true as it hasn't been dragged yet or is not draggable
            if (self.draggable) {
                self._makeDraggable(this);
            }

            if (self.popupMode === "small") {
                //hide the content pane, make it have no height and reposition for small popups
                dojo.query(".contentPane", this.domNode).style({ "display": "none", "height": "0px" });
                this.reposition();
            }

            this.domNode.style.opacity = 1;

        },

        _popupHidden: function (self) {
            //scope: self is the class, this is the child popup that is opened.
            //console.log("hidden");

            //if feature was scaled up, scale it down here
            var feature = this.getSelectedFeature();
            if (feature && feature.scaleSelected) {
                self._scaleFeatureDown(feature);
            }


            //remove any event handlers assigned to the popup explicity
            for (var i = 0, len = this.popupEvents.length; i < len; i++) {
                if (this.popupEvents[i]) {
                    this.popupEvents[i].remove();
                }
            }

            self.openPopups.splice(this.index, 1);
            dojo.destroy(this.domNode);
            //reset the indexes of all other popups
            for (var i = 0, len = self.openPopups.length; i < len; i++) {
                self.openPopups[i].index = i;
            }
        },

        //#endregion

        //#region draggable / resizable stuff

        _makeDraggable: function (popup) {
            var titlePane = dojo.query(".titlePane", popup.domNode);
            titlePane.style("cursor", "move");

            popup.popupEvents.push(on(titlePane[0], "mousedown", lang.hitch(this, function (e) {

                //if maximized or this is a titleButton click don't do anything
                if (popup._maximized || e.target.className.indexOf("titleButton") !== -1) {
                    return;
                }

                var startLeft = domStyle.get(popup.domNode, "left");
                var startTop = domStyle.get(popup.domNode, "top");
                this.map.popupDragging = {
                    popup: popup,
                    startLeft: startLeft,
                    startTop: startTop,
                    startX: e.screenX,
                    startY: e.screenY
                };

                //if the popupwrapper has a bottom setting instead of top, convert bottom to equivalent top for correct resizing
                var bottom = domStyle.get(popup.wrapperNode, "bottom");
                if (bottom && bottom.toString().indexOf("px") !== null) {
                    bottom = parseInt(bottom.replace("px", ""));
                }
                if (bottom && bottom !== 0) {
                    domStyle.set(popup.wrapperNode, "bottom", ""); //remove bottom
                    var wrapperHeight = domStyle.get(popup.wrapperNode, "height"); //get height of wrapper
                    domStyle.set(popup.wrapperNode, "top", ((wrapperHeight * -1) - bottom).toString() + "px"); //set top to negative of wrapper height minus the bottom value
                }

                //while dragging make all text unselectable
                dojo.setSelectable(this.map.root, false);
            })));


        },

        _resetPopupDragPosition: function (popup) {
            domStyle.set(popup.domNode, "left", popup.draggedLeft + "px");
            domStyle.set(popup.domNode, "top", popup.draggedTop + "px");
        },


        //#endregion

        //#region private methods

        _setPopupMode: function () {
            this.popupMode = this.map.width <= this.smallStyleWidthBreak ? "small" : "normal";
        },

        _addTemplateOptions: function (popup) {
            var feature = popup.getSelectedFeature();
            var template = feature.infoTemplate || feature.getLayer().infoTemplate;
            var templateOptions = template.info.extended || {};

            //if (templateOptions.tabs && tempalteOptions.tabs.length) {
            //    console.log('tabs exist');
            //}

            //set the template proeprties of the popup. Options set in a template object take precedence over options set on the PopupExtended.

            //reset the class back to nothing then add theme classes.
            popup.domNode.className = "esriPopup esriPopupVisible";
            if (templateOptions.themeClass) {
                dojo.addClass(popup.domNode, templateOptions.themeClass);
            }
            else if (this.themeClass) {
                dojo.addClass(popup.domNode, this.themeClass);
            }

            //scale down the previous feature if one was selected
            if (popup.currentIndex !== undefined && popup.features.length > popup.currentIndex) {
                var prevFeature = popup.features[popup.currentIndex];
                if (prevFeature.scaleSelected) {
                    this._scaleFeatureDown(prevFeature);
                }
            }
            popup.currentIndex = popup.selectedIndex; //maintain our own selected Index for scaling down if needed

            var scaleSelected = templateOptions.scaleSelected || this.scaleSelected;
            if (scaleSelected) {
                feature.scaleSelected = scaleSelected;
                this._scaleFeatureUp(feature);
            }

            //add an extra class for the small popup so it can be themed differently if desired
            if (this.popupMode === "small") {
                dojo.addClass(popup.domNode, "small");
            }
     
        },

        _featureArraysMatch: function (a, b) {

            //compare the geometries of two feature arrays to see if they match exactly. Order doesn't matter
            if ((a == null || b == null) || a.length != b.length) {
                return false; //if either is null or length doesn;t match then false straight up
            }

            var len = a.length;
            for (var i = 0; i < len; i++) {
                var found = false;
                for (var j = 0; j < len; j++) {
                    if (a[i].geometry === b[j].geometry) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    return false;
                }

            }
            return true;

        },

        _scaleFeatureUp: function (feature) {
            if (!feature) {
                return;
            }

            var shape = feature.getShape();
            if (shape) {
                shape.moveToFront();
                var bbox = shape.getBoundingBox();
                var x = bbox.x + bbox.width / 2;
                var y = bbox.y + bbox.height / 2
                fx.animateTransform({
                    duration: 300,
                    shape: shape,
                    transform: [
                        { name: "scaleAt", start: [1, 1, x, y], end: [feature.scaleSelected, feature.scaleSelected, x, y] }
                    ]
                }).play();
            }
        },

        _scaleFeatureDown: function (feature) {
            if (!feature) {
                return;
            }

            var shape = feature.getShape();
            if (shape) {
                var bbox = shape.getBoundingBox();
                var x = bbox.x + bbox.width / 2;
                var y = bbox.y + bbox.height / 2
                fx.animateTransform({
                    duration: 300,
                    shape: shape,
                    transform: [
                        { name: "scaleAt", start: [feature.scaleSelected, feature.scaleSelected, x, y], end: [1, 1, x, y] }
                    ]
                }).play();
                feature.scaleSelected = null;
            }
        }


        //#endregion

    });

});
