// Copyright (c) 2022 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

// libraries
import React, {Component, createRef, useMemo} from 'react';
import {withTheme} from 'styled-components';
import {StaticMap, MapRef} from 'react-map-gl';
import DeckGL from '@deck.gl/react';
import {createSelector, Selector} from 'reselect';
import mapboxgl from 'mapbox-gl';

import {VisStateActions, MapStateActions, UIStateActions} from '@kepler.gl/actions';

// components
import MapPopoverFactory from './map/map-popover';
import MapControlFactory from './map/map-control';
import {StyledMapContainer, StyledAttrbution} from './common/styled-components';

import EditorFactory from './editor/editor';

// utils
import {
  generateMapboxLayers,
  updateMapboxLayers,
  LayerBaseConfig,
  VisualChannelDomain,
  EditorLayerUtils
} from '@kepler.gl/layers';
import {MapState, MapControls, Viewport, SplitMap, SplitMapLayers} from '@kepler.gl/types';
import {
  errorNotification,
  setLayerBlending,
  isStyleUsingMapboxTiles,
  transformRequest,
  observeDimensions,
  unobserveDimensions,
  hasMobileWidth,
  EMPTY_MAPBOX_STYLE,
  getMapLayersFromSplitMaps,
  onViewPortChange,
  getViewportFromMapState,
  normalizeEvent
} from '@kepler.gl/utils';
import {breakPointValues} from '@kepler.gl/styles';

// default-settings
import {
  FILTER_TYPES,
  GEOCODER_LAYER_ID,
  THROTTLE_NOTIFICATION_TIME,
  DEFAULT_PICKING_RADIUS
} from '@kepler.gl/constants';

import ErrorBoundary from './common/error-boundary';
import {LOCALE_CODES} from '@kepler.gl/localization';
import {MapView} from '@deck.gl/core';
import {
  MapStyle,
  computeDeckLayers,
  getLayerHoverProp,
  LayerHoverProp,
  prepareLayersForDeck,
  prepareLayersToRender,
  LayersToRender
} from '@kepler.gl/reducers';
import {VisState} from '@kepler.gl/schemas';

/** @type {{[key: string]: React.CSSProperties}} */
const MAP_STYLE: {[key: string]: React.CSSProperties} = {
  container: {
    display: 'inline-block',
    position: 'relative',
    width: '100%',
    height: '100%'
  },
  top: {
    position: 'absolute',
    top: '0px',
    pointerEvents: 'none',
    width: '100%',
    height: '100%'
  }
};

const LOCALE_CODES_ARRAY = Object.keys(LOCALE_CODES);

const MAPBOXGL_STYLE_UPDATE = 'style.load';
const MAPBOXGL_RENDER = 'render';
const nop = () => {};

const MapboxLogo = () => (
  <div className="attrition-logo">
    Basemap by:
    <a
      className="mapboxgl-ctrl-logo"
      target="_blank"
      rel="noopener noreferrer"
      href="https://www.mapbox.com/"
      aria-label="Mapbox logo"
    />
  </div>
);

export const Attribution = ({showMapboxLogo = true}) => {
  const isPalm = hasMobileWidth(breakPointValues);

  const memoizedComponents = useMemo(() => {
    if (!showMapboxLogo) {
      return (
        <StyledAttrbution>
          <a
            href="http://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
          >
            © OpenStreetMap
          </a>
        </StyledAttrbution>
      );
    }

    return (
      <StyledAttrbution>
        {isPalm ? <MapboxLogo /> : null}
        <div className="attrition-link">
          <a href="https://kepler.gl/policy/" target="_blank" rel="noopener noreferrer">
            © kepler.gl |{' '}
          </a>
          <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener noreferrer">
            © Mapbox |{' '}
          </a>
          <a
            href="http://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
          >
            © OpenStreetMap |{' '}
          </a>
          <a href="https://www.mapbox.com/map-feedback/" target="_blank" rel="noopener noreferrer">
            <strong>Improve this map </strong>
            {!isPalm ? <strong> | </strong> : null}
          </a>
          {!isPalm ? <MapboxLogo /> : null}
        </div>
      </StyledAttrbution>
    );
  }, [showMapboxLogo, isPalm]);

  return memoizedComponents;
};

MapContainerFactory.deps = [MapPopoverFactory, MapControlFactory, EditorFactory];

type MapboxStyle = string | object | undefined;
type PropSelector<R> = Selector<MapContainerProps, R>;

interface MapContainerProps {
  visState: VisState;
  mapState: MapState;
  mapControls: MapControls;
  mapStyle: {bottomMapStyle?: MapboxStyle; topMapStyle?: MapboxStyle} & MapStyle;
  mapboxApiAccessToken: string;
  mapboxApiUrl: string;
  visStateActions: typeof VisStateActions;
  mapStateActions: typeof MapStateActions;
  uiStateActions: typeof UIStateActions;

  // optional
  primary?: boolean; // primary one will be reporting its size to appState
  readOnly?: boolean;
  isExport?: boolean;
  onMapToggleLayer?: Function;
  onMapStyleLoaded?: Function;
  onMapRender?: Function;
  getMapboxRef?: (mapbox?: MapRef | null, index?: number) => void;
  index?: number;

  locale?: any;
  theme?: any;
  editor?: any;
  MapComponent?: typeof StaticMap;
  deckGlProps?: any;
  onDeckInitialized?: (a: any, b: any) => void;
  onViewStateChange?: (viewport: Viewport) => void;

  topMapContainerProps: any;
  bottomMapContainerProps: any;
  transformRequest?: any;
}

export default function MapContainerFactory(
  MapPopover,
  MapControl,
  Editor
): React.ComponentType<MapContainerProps> {
  class MapContainer extends Component<MapContainerProps> {
    displayName = 'MapContainer';
    static defaultProps = {
      MapComponent: StaticMap,
      deckGlProps: {},
      index: 0,
      primary: true
    };

    state = {
      // Determines whether attribution should be visible based the result of loading the map style
      showMapboxAttribution: true
    };

    constructor(props) {
      super(props);
    }

    componentDidMount() {
      if (!this._ref.current) {
        return;
      }
      observeDimensions(this._ref.current, this._handleResize);
    }

    componentWillUnmount() {
      // unbind mapboxgl event listener
      if (this._map) {
        this._map?.off(MAPBOXGL_STYLE_UPDATE, nop);
        this._map?.off(MAPBOXGL_RENDER, nop);
      }
      if (!this._ref.current) {
        return;
      }
      unobserveDimensions(this._ref.current);
    }

    _deck: any = null;
    _map: mapboxgl.Map | null = null;
    _ref = createRef<HTMLDivElement>();
    _deckGLErrorsElapsed: {[id: string]: number} = {};

    previousLayers = {
      // [layers.id]: mapboxLayerConfig
    };

    _handleResize = dimensions => {
      const {primary} = this.props;
      if (primary) {
        const {mapStateActions} = this.props;
        if (dimensions && dimensions.width > 0 && dimensions.height > 0) {
          mapStateActions.updateMap(dimensions);
        }
      }
    };

    layersSelector: PropSelector<VisState['layers']> = props => props.visState.layers;
    layerDataSelector: PropSelector<VisState['layers']> = props => props.visState.layerData;
    splitMapSelector: PropSelector<SplitMap[]> = props => props.visState.splitMaps;
    splitMapIndexSelector: PropSelector<number | undefined> = props => props.index;
    mapLayersSelector: PropSelector<SplitMapLayers | null | undefined> = createSelector(
      this.splitMapSelector,
      this.splitMapIndexSelector,
      getMapLayersFromSplitMaps
    );
    layerOrderSelector: PropSelector<VisState['layerOrder']> = props => props.visState.layerOrder;
    layersToRenderSelector: PropSelector<LayersToRender> = createSelector(
      this.layersSelector,
      this.layerDataSelector,
      this.mapLayersSelector,
      prepareLayersToRender
    );
    layersForDeckSelector = createSelector(
      this.layersSelector,
      this.layerDataSelector,
      prepareLayersForDeck
    );
    filtersSelector = props => props.visState.filters;
    polygonFiltersSelector = createSelector(this.filtersSelector, filters =>
      filters.filter(f => f.type === FILTER_TYPES.polygon && f.enabled !== false)
    );
    featuresSelector = props => props.visState.editor.features;
    selectedFeatureSelector = props => props.visState.editor.selectedFeature;
    featureCollectionSelector = createSelector(
      this.polygonFiltersSelector,
      this.featuresSelector,
      (polygonFilters, features) => ({
        type: 'FeatureCollection',
        features: features.concat(polygonFilters.map(f => f.value))
      })
    );
    selectedPolygonIndexSelector = createSelector(
      this.featureCollectionSelector,
      this.selectedFeatureSelector,
      (collection, selectedFeature) =>
        collection.features.findIndex(f => f.id === selectedFeature?.id)
    );
    selectedFeatureIndexArraySelector = createSelector(
      (value: number) => value,
      value => {
        return value < 0 ? [] : [value];
      }
    );

    mapboxLayersSelector = createSelector(
      this.layersSelector,
      this.layerDataSelector,
      this.layerOrderSelector,
      this.layersToRenderSelector,
      generateMapboxLayers
    );

    /* component private functions */
    _onCloseMapPopover = () => {
      this.props.visStateActions.onLayerClick(null);
    };

    _onLayerSetDomain = (idx: number, colorDomain: VisualChannelDomain) => {
      this.props.visStateActions.layerConfigChange(this.props.visState.layers[idx], {
        colorDomain
      } as Partial<LayerBaseConfig>);
    };

    _handleMapToggleLayer = layerId => {
      const {index: mapIndex = 0, visStateActions} = this.props;
      visStateActions.toggleLayerForMap(mapIndex, layerId);
    };

    _onMapboxStyleUpdate = update => {
      // force refresh mapboxgl layers
      this.previousLayers = {};
      this._updateMapboxLayers();

      if (update && update.style) {
        // No attributions are needed if the style doesn't reference Mapbox sources
        this.setState({showMapboxAttribution: isStyleUsingMapboxTiles(update.style)});
      }

      if (typeof this.props.onMapStyleLoaded === 'function') {
        this.props.onMapStyleLoaded(this._map);
      }
    };

    _setMapboxMap: React.Ref<MapRef> = mapbox => {
      if (!this._map && mapbox) {
        this._map = mapbox.getMap();
        // i noticed in certain context we don't access the actual map element
        if (!this._map) {
          return;
        }
        // bind mapboxgl event listener
        this._map.on(MAPBOXGL_STYLE_UPDATE, this._onMapboxStyleUpdate);

        this._map.on(MAPBOXGL_RENDER, () => {
          if (typeof this.props.onMapRender === 'function') {
            this.props.onMapRender(this._map);
          }
        });
      }

      if (this.props.getMapboxRef) {
        // The parent component can gain access to our MapboxGlMap by
        // providing this callback. Note that 'mapbox' will be null when the
        // ref is unset (e.g. when a split map is closed).
        this.props.getMapboxRef(mapbox, this.props.index);
      }
    };

    _onDeckInitialized(gl) {
      if (this.props.onDeckInitialized) {
        this.props.onDeckInitialized(this._deck, gl);
      }
    }

    _onBeforeRender = ({gl}) => {
      setLayerBlending(gl, this.props.visState.layerBlending);
    };

    _onDeckError = (error, layer) => {
      const errorMessage = `An error in deck.gl: ${error.message} in ${layer.id}`;
      const notificationId = `${layer.id}-${error.message}`;

      // Throttle error notifications, as React doesn't like too many state changes from here.
      const lastShown = this._deckGLErrorsElapsed[notificationId];
      if (!lastShown || lastShown < Date.now() - THROTTLE_NOTIFICATION_TIME) {
        this._deckGLErrorsElapsed[notificationId] = Date.now();

        // Create new error notification or update existing one with same id.
        // Update is required to preserve the order of notifications as they probably are going to "jump" based on order of errors.
        const {uiStateActions} = this.props;
        uiStateActions.addNotification(
          errorNotification({
            message: errorMessage,
            id: notificationId
          })
        );
      }
    };

    /* component render functions */

    /* eslint-disable complexity */
    _renderMapPopover() {
      // TODO: move this into reducer so it can be tested
      const {
        mapState,
        visState: {
          hoverInfo,
          clicked,
          datasets,
          interactionConfig,
          layers,
          mousePos: {mousePosition, coordinate, pinned}
        }
      } = this.props;
      const layersToRender = this.layersToRenderSelector(this.props);

      if (!mousePosition || !interactionConfig.tooltip) {
        return null;
      }

      const layerHoverProp = getLayerHoverProp({
        interactionConfig,
        hoverInfo,
        layers,
        layersToRender,
        datasets
      });

      const compareMode = interactionConfig.tooltip.config
        ? interactionConfig.tooltip.config.compareMode
        : false;

      let pinnedPosition = {};
      let layerPinnedProp: LayerHoverProp | null = null;
      if (pinned || clicked) {
        // project lnglat to screen so that tooltip follows the object on zoom
        const viewport = getViewportFromMapState(mapState);
        const lngLat = clicked ? clicked.coordinate : pinned.coordinate;
        pinnedPosition = this._getHoverXY(viewport, lngLat);
        layerPinnedProp = getLayerHoverProp({
          interactionConfig,
          hoverInfo: clicked,
          layers,
          layersToRender,
          datasets
        });
        if (layerHoverProp && layerPinnedProp) {
          layerHoverProp.primaryData = layerPinnedProp.data;
          layerHoverProp.compareType = interactionConfig.tooltip.config.compareType;
        }
      }

      const commonProp = {
        onClose: this._onCloseMapPopover,
        zoom: mapState.zoom,
        container: this._deck ? this._deck.canvas : undefined
      };

      return (
        <ErrorBoundary>
          {layerPinnedProp && (
            <MapPopover
              {...pinnedPosition}
              {...commonProp}
              layerHoverProp={layerPinnedProp}
              coordinate={interactionConfig.coordinate.enabled && (pinned || {}).coordinate}
              frozen={true}
              isBase={compareMode}
            />
          )}
          {layerHoverProp && (!layerPinnedProp || compareMode) && (
            <MapPopover
              x={mousePosition[0]}
              y={mousePosition[1]}
              {...commonProp}
              layerHoverProp={layerHoverProp}
              frozen={false}
              coordinate={interactionConfig.coordinate.enabled && coordinate}
            />
          )}
        </ErrorBoundary>
      );
    }

    /* eslint-enable complexity */

    _getHoverXY(viewport, lngLat) {
      const screenCoord = !viewport || !lngLat ? null : viewport.project(lngLat);
      return screenCoord && {x: screenCoord[0], y: screenCoord[1]};
    }

    _renderDeckOverlay(layersForDeck, options = {primaryMap: false}) {
      const {
        mapState,
        mapStyle,
        visState,
        visStateActions,
        mapboxApiAccessToken,
        mapboxApiUrl,
        deckGlProps,
        index,
        mapControls,
        theme
      } = this.props;

      const {hoverInfo, editor} = visState;
      const {primaryMap} = options;

      // disable double click zoom when editor is in any draw mode
      const {mapDraw} = mapControls;
      const {active: editorMenuActive = false} = mapDraw || {};
      const isEditorDrawingMode = EditorLayerUtils.isDrawingActive(editorMenuActive, editor.mode);

      const viewport = getViewportFromMapState(mapState);

      const editorFeatureSelectedIndex = this.selectedPolygonIndexSelector(this.props);

      const {setFeatures, onLayerClick, setSelectedFeature} = visStateActions;

      const deckGlLayers = computeDeckLayers(
        {
          visState,
          mapState,
          mapStyle
        },
        {
          mapIndex: index,
          primaryMap,
          mapboxApiAccessToken,
          mapboxApiUrl,
          layersForDeck,
          editorInfo: primaryMap
            ? {
                editor,
                editorMenuActive,
                onSetFeatures: setFeatures,
                setSelectedFeature,
                featureCollection: this.featureCollectionSelector(this.props),
                selectedFeatureIndexes: this.selectedFeatureIndexArraySelector(
                  editorFeatureSelectedIndex
                ),
                viewport
              }
            : undefined
        },
        this._onLayerSetDomain,
        deckGlProps
      );

      const extraDeckParams: {
        getTooltip?: (info: any) => object | null;
        getCursor?: ({isDragging: boolean}) => string;
      } = {};
      if (primaryMap) {
        extraDeckParams.getTooltip = info =>
          EditorLayerUtils.getTooltip(info, {
            editorMenuActive,
            editor,
            theme
          });

        extraDeckParams.getCursor = ({isDragging}: {isDragging: boolean}) => {
          const editorCursor = EditorLayerUtils.getCursor({
            editorMenuActive,
            editor,
            hoverInfo
          });
          if (editorCursor) return editorCursor;

          if (isDragging) return 'grabbing';
          if (hoverInfo?.layer) return 'pointer';
          return 'grab';
        };
      }

      const views = deckGlProps?.views
        ? deckGlProps?.views()
        : new MapView({legacyMeterSizes: true});

      return (
        <div
          onMouseMove={
            primaryMap
              ? // @ts-expect-error should be deck viewport
                event => this.props.visStateActions.onMouseMove(normalizeEvent(event, viewport))
              : undefined
          }
        >
          <DeckGL
            id="default-deckgl-overlay"
            {...deckGlProps}
            views={views}
            layers={deckGlLayers}
            controller={{doubleClickZoom: !isEditorDrawingMode}}
            viewState={mapState}
            pickingRadius={DEFAULT_PICKING_RADIUS}
            onBeforeRender={this._onBeforeRender}
            onViewStateChange={this._onViewportChange}
            {...extraDeckParams}
            onHover={(data, event) => {
              const res = EditorLayerUtils.onHover(data, {
                editorMenuActive,
                editor,
                hoverInfo
              });
              if (res) return;

              visStateActions.onLayerHover(data);
            }}
            onClick={(data, event) => {
              // @ts-ignore
              const res = EditorLayerUtils.onClick(data, event, {
                editorMenuActive,
                editor,
                onLayerClick,
                setSelectedFeature,
                mapIndex: index
              });
              if (res) return;

              visStateActions.onLayerClick(data);
            }}
            onError={this._onDeckError}
            ref={comp => {
              // @ts-ignore
              if (comp && comp.deck && !this._deck) {
                // @ts-ignore
                this._deck = comp.deck;
              }
            }}
            onWebGLInitialized={gl => this._onDeckInitialized(gl)}
          />
        </div>
      );
    }

    _updateMapboxLayers() {
      const mapboxLayers = this.mapboxLayersSelector(this.props);
      if (!Object.keys(mapboxLayers).length && !Object.keys(this.previousLayers).length) {
        return;
      }

      updateMapboxLayers(this._map, mapboxLayers, this.previousLayers);

      this.previousLayers = mapboxLayers;
    }

    _renderMapboxOverlays() {
      if (this._map && this._map.isStyleLoaded()) {
        this._updateMapboxLayers();
      }
    }

    _renderEditorContextMenu() {
      const {visState, visStateActions, index} = this.props;
      const {layers, datasets, editor} = visState;

      const layersToRender = this.layersToRenderSelector(this.props);

      return (
        <Editor
          index={index}
          datasets={datasets}
          editor={editor}
          filters={this.polygonFiltersSelector(this.props)}
          layers={layers}
          layersToRender={layersToRender}
          onDeleteFeature={visStateActions.deleteFeature}
          onSelect={visStateActions.setSelectedFeature}
          onTogglePolygonFilter={visStateActions.setPolygonFilterLayer}
          onSetEditorMode={visStateActions.setEditorMode}
          style={{
            pointerEvents: 'all',
            position: 'absolute',
            display: editor.visible ? 'block' : 'none'
          }}
        />
      );
    }

    _onViewportChange = ({viewState}) => {
      onViewPortChange(
        viewState,
        this.props.mapStateActions.updateMap,
        this.props.onViewStateChange,
        this.props.primary
      );
    };

    _toggleMapControl = panelId => {
      const {index, uiStateActions} = this.props;

      uiStateActions.toggleMapControl(panelId, Number(index));
    };

    /* eslint-disable complexity */
    _renderMap() {
      const {
        visState,
        mapState,
        mapStyle,
        mapStateActions,
        MapComponent = StaticMap,
        mapboxApiAccessToken,
        mapboxApiUrl,
        mapControls,
        isExport,
        locale,
        uiStateActions,
        visStateActions,
        index,
        primary,
        bottomMapContainerProps,
        topMapContainerProps
      } = this.props;

      const {layers, datasets, editor, interactionConfig} = visState;

      const layersToRender = this.layersToRenderSelector(this.props);
      const layersForDeck = this.layersForDeckSelector(this.props);

      // Current style can be a custom style, from which we pull the mapbox API acccess token
      const currentStyle = mapStyle.mapStyles?.[mapStyle.styleType];
      const mapProps = {
        ...mapState,
        width: '100%',
        height: '100%',
        preserveDrawingBuffer: true,
        mapboxApiAccessToken: currentStyle?.accessToken || mapboxApiAccessToken,
        mapboxApiUrl,
        transformRequest: this.props.transformRequest || transformRequest
      };

      const hasGeocoderLayer = Boolean(layers.find(l => l.id === GEOCODER_LAYER_ID));
      const isSplit = Boolean(mapState.isSplit);

      return (
        <>
          <MapControl
            datasets={datasets}
            availableLocales={LOCALE_CODES_ARRAY}
            dragRotate={mapState.dragRotate}
            isSplit={isSplit}
            primary={primary}
            isExport={isExport}
            layers={layers}
            layersToRender={layersToRender}
            mapIndex={index}
            mapControls={mapControls}
            readOnly={this.props.readOnly}
            scale={mapState.scale || 1}
            top={interactionConfig.geocoder && interactionConfig.geocoder.enabled ? 52 : 0}
            editor={editor}
            locale={locale}
            onTogglePerspective={mapStateActions.togglePerspective}
            onToggleSplitMap={mapStateActions.toggleSplitMap}
            onMapToggleLayer={this._handleMapToggleLayer}
            onToggleMapControl={this._toggleMapControl}
            onSetEditorMode={visStateActions.setEditorMode}
            onSetLocale={uiStateActions.setLocale}
            onToggleEditorVisibility={visStateActions.toggleEditorVisibility}
            mapHeight={mapState.height}
          />
          {/* 
          // @ts-ignore */}
          <MapComponent
            key="bottom"
            {...mapProps}
            mapStyle={mapStyle.bottomMapStyle ?? EMPTY_MAPBOX_STYLE}
            {...bottomMapContainerProps}
            ref={this._setMapboxMap}
          >
            {this._renderDeckOverlay(layersForDeck, {primaryMap: true})}
            {this._renderMapboxOverlays()}
            {this._renderEditorContextMenu()}
          </MapComponent>
          {mapStyle.topMapStyle || hasGeocoderLayer ? (
            <div style={MAP_STYLE.top}>
              {/* 
              // @ts-ignore */}
              <MapComponent
                key="top"
                {...mapProps}
                mapStyle={mapStyle.topMapStyle}
                {...topMapContainerProps}
              >
                {this._renderDeckOverlay({[GEOCODER_LAYER_ID]: hasGeocoderLayer})}
              </MapComponent>
            </div>
          ) : null}
          {this._renderMapPopover()}
          {!isSplit || index === 1 ? (
            <Attribution showMapboxLogo={this.state.showMapboxAttribution} />
          ) : null}
        </>
      );
    }

    render() {
      return (
        <StyledMapContainer
          ref={this._ref}
          style={MAP_STYLE.container}
          onContextMenu={event => event.preventDefault()}
        >
          {this._renderMap()}
        </StyledMapContainer>
      );
    }
  }

  return withTheme(MapContainer);
}
