document.addEventListener('DOMContentLoaded', function() {

    const CONFIG = {
      mapCenter: [-41.2865, 174.7762], initialZoom: 5, minZoom: 4, maxZoom: 12,
      mapBounds: [[-55, 160], [-30, 185]],
      geoJsonUrl: 'https://aurora-map-nz.thenamesrock.workers.dev/',
      tnrScoreUrl: 'https://tnr-aurora-forecast.thenamesrock.workers.dev/',
      refreshInterval: 300000
    };

    const isTouchDevice = L.Browser.touch;
    const map = L.map('map', {
      center: CONFIG.mapCenter, zoom: CONFIG.initialZoom, maxZoom: CONFIG.maxZoom, minZoom: CONFIG.minZoom,
      maxBounds: CONFIG.mapBounds, maxBoundsViscosity: 0.9, dragging: true, touchZoom: true, scrollWheelZoom: false,
      zoomControl: false 
    });

    const touchMessageElement = document.getElementById('touch-interaction-message');
    const auroraStatusBannerElement = document.getElementById('aurora-status-banner'); 
    const mapContainerElement = document.getElementById('map-container');
    const infoBottomPanelElement = document.getElementById('info-bottom-panel');
    const infoPanelContentElement = document.getElementById('info-panel-content');
    const infoPanelTitleElement = document.getElementById('info-panel-title');
    const infoPanelCloseButton = document.getElementById('info-panel-close-button');
    let clickedOnFeature = false; 

    if (isTouchDevice && touchMessageElement) {
      touchMessageElement.style.display = 'block';
      setTimeout(() => { if (touchMessageElement) touchMessageElement.style.display = 'none'; }, 5000);
    }

    function showInfoPanel(title, htmlContent) {
        if(infoPanelTitleElement) infoPanelTitleElement.textContent = title;
        if(infoPanelContentElement) infoPanelContentElement.innerHTML = htmlContent;
        if(mapContainerElement) mapContainerElement.classList.add('panel-active');
        if(infoBottomPanelElement) infoBottomPanelElement.classList.add('visible');
        setTimeout(() => map.invalidateSize({ animate: false }), 50); 
    }
    function hideInfoPanel() {
        if(mapContainerElement) mapContainerElement.classList.remove('panel-active');
        if(infoBottomPanelElement) infoBottomPanelElement.classList.remove('visible');
        setTimeout(() => map.invalidateSize({ animate: false }), 300); 
    }
    if(infoPanelCloseButton) infoPanelCloseButton.addEventListener('click', hideInfoPanel);

    const InfoControl = L.Control.extend({
        options: { position: 'topright' },
        onAdd: function (mapCtrl) { 
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom-info');
            container.style.backgroundColor = 'rgba(255,255,255,0.8)'; container.style.padding = '5px 7px';
            container.style.border = '1px solid rgba(0,0,0,0.2)'; container.style.borderRadius = '4px';
            container.style.cursor = 'pointer'; container.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)';
            container.innerHTML = '<span style="font-size: 1.3em; font-weight: bold; color: #333; line-height:1;">ⓘ</span>';
            L.DomEvent.disableClickPropagation(container); L.DomEvent.disableScrollPropagation(container);
            container.onclick = function(e) { 
                if (infoBottomPanelElement && infoBottomPanelElement.classList.contains('visible')) { hideInfoPanel(); } 
                showExplanationPopup(mapCtrl); 
            };
            return container;
        },
        onRemove: function(mapCtrl) {} 
    });
    let explanationPopup = null;
    function showExplanationPopup(mapInstance) {
        if (explanationPopup && mapInstance.hasLayer(explanationPopup)) { mapInstance.closePopup(explanationPopup); explanationPopup = null; return; }
        const explanationContent = `<div style="max-width: 300px; max-height: 250px; overflow-y: auto; font-size: 12px; line-height: 1.4;"><h4>How This Map Works</h4><p>This map provides an aurora visibility forecast for New Zealand.</p><p>The <strong>'Potential Visibility (next 2 hrs)'</strong> percentage (shown in polygon popups & influencing map transparency) is a proprietary forecast by <strong>TNR Protography</strong>, utilizing data primarily from NOAA SWPC. This value reflects real-world viewing conditions, including solar and lunar illumination for specific areas.</p><p>The <strong>color of each region</strong> indicates the 'Potential Aurora Visibility with no Solar or Lunar Influence.' This represents the idealized maximum height/reach of the aurora for broader forecasting, before considering local sun/moon conditions. The map updates automatically.</p></div>`;
        explanationPopup = L.popup({maxWidth: 350, minWidth: 280, autoPanPadding: L.point(30, 30)}).setLatLng(mapInstance.getCenter()).setContent(explanationContent).openOn(mapInstance);
    }
    new InfoControl().addTo(map);

    L.control.zoom({ position: 'topleft' }).addTo(map); 
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd'
    }).addTo(map);

    let geoJsonLayer;
    const loadingIndicator = document.getElementById('loading-indicator');
    let lastUpdatedElementInLegend = null; 

    let currentGlobalFillOpacity = 0.25;
    let currentGlobalLineOpacity = 0.1; 
    let currentTnrScore = 0; 
    let currentTnrLastUpdated = new Date(); 

    function getColorForScore(score) {
        if (score === undefined || score === null || isNaN(score)) return '#808080'; 
        if (score < 10) { return '#808080'; } 
        else if (score < 25) { return '#FFD700'; } 
        else if (score < 40) { return '#FFA500'; } 
        else if (score < 50) { return '#FF4500'; } 
        else if (score < 80) { return '#800080'; } 
        else { return '#FF1493'; }
    }
    function calculateFillOpacityFromTnr(tnrScore) {
        if (typeof tnrScore !== 'number' || isNaN(tnrScore) || tnrScore < 0) tnrScore = 0;
        const calculatedOpacity = (tnrScore / 2) * 0.01; 
        return Math.min(calculatedOpacity, 0.5);
    }
    function calculateLineOpacity(fillOpacityValue) {
        const minLineOpacity = 0.1; 
        const maxLineOpacity = 0.8;
        const safeFillOpacityValue = (typeof fillOpacityValue === 'number' && !isNaN(fillOpacityValue)) ? fillOpacityValue : 0;
        const normalizedFill = safeFillOpacityValue / 0.5; 
        let lineOpacity = minLineOpacity + normalizedFill * (maxLineOpacity - minLineOpacity);
        return Math.max(minLineOpacity, Math.min(lineOpacity, maxLineOpacity));
    }
    function getTnrScoreDescription(score) {
        if (score === null || isNaN(score)) { return ""; }
        if (score < 10) { return "😞: Little to no auroral activity.";
        } else if (score >= 10 && score <= 25) { return "😐: Minimal auroral activity likely, possibly only a faint glow detectable by professional cameras.";
        } else if (score > 25 && score <= 40) { return "😊: Clear auroral activity visible in camera/phone images, potentially visible to the naked eye under ideal conditions.";
        } else if (score > 40 && score < 50) { return "🙂: Faint auroral glow potentially visible to the naked eye, possibly with some color.";
        } else if (score >= 50 && score < 80) { return "😀: Good chance of seeing auroral color with the naked eye (depending on individual eyesight and viewing conditions).";
        } else { return "🤩: High probability of significant auroral substorms, potentially displaying a wide range of colors and dynamic activity overhead or in the northern sky."; }
    }

    async function loadGeoJSON() {
      console.log("--- loadGeoJSON: Start ---");
      if(loadingIndicator) loadingIndicator.style.display = 'block';
      if(loadingIndicator) loadingIndicator.textContent = 'Loading Data...';
      
      let tnrScoreFetchSuccess = false;
      let fetchedTnrScore = 0; 
      let fetchedTnrLastUpdated = new Date();

      try { 
        console.log("Fetching TNR score...");
        if(loadingIndicator) loadingIndicator.textContent = 'Loading Aurora Index...';
        try { 
          const tnrResponse = await fetch(CONFIG.tnrScoreUrl + '?cachebust=' + new Date().getTime());
          if (!tnrResponse.ok) {
            const errorText = await tnrResponse.text(); console.error("Failed to fetch TNR score. Status:", tnrResponse.status, "Body:", errorText);
          } else {
            const tnrData = await tnrResponse.json();
            if (tnrData && tnrData.values && Array.isArray(tnrData.values) && tnrData.values.length > 0) {
              let latestEntry = tnrData.values.reduce((latest, current) => new Date(current.lastUpdated) > new Date(latest.lastUpdated) ? current : latest);
              const parsedScore = parseFloat(latestEntry.value);
              if (isNaN(parsedScore)) { console.error("Latest TNR score is not a valid number:", latestEntry.value);
              } else { fetchedTnrScore = parsedScore; fetchedTnrLastUpdated = new Date(latestEntry.lastUpdated); tnrScoreFetchSuccess = true; }
            } else { console.error("TNR score data is not in the expected format or is empty."); }
          }
        } catch (tnrError) { console.error("Error during TNR score fetch (inner catch):", tnrError); } 
        
        currentTnrScore = fetchedTnrScore; currentTnrLastUpdated = fetchedTnrLastUpdated;
        currentGlobalFillOpacity = calculateFillOpacityFromTnr(currentTnrScore);
        currentGlobalLineOpacity = calculateLineOpacity(currentGlobalFillOpacity);
        
        if (auroraStatusBannerElement) {
            if (currentTnrScore <= 0.01) {
                auroraStatusBannerElement.innerHTML = `The sun is up or the moon is too bright for any kind of potential aurora visibility.`;
                auroraStatusBannerElement.className = 'warning';
            } else {
                let bannerText = `<b>Potential Visibility (next 2 hrs):</b> ${currentTnrScore.toFixed(1)}% `;
                if (tnrScoreFetchSuccess) { bannerText += `<span>(Updated: ${currentTnrLastUpdated.toLocaleTimeString()})</span>`;
                } else { bannerText += `<span>(Update time N/A)</span>`; }
                bannerText += ` | Fill: ${(currentGlobalFillOpacity * 100).toFixed(0)}%, Line: ${(currentGlobalLineOpacity * 100).toFixed(0)}%`;
                auroraStatusBannerElement.innerHTML = bannerText;
                auroraStatusBannerElement.className = '';
            }
        }
        
        console.log("Fetching GeoJSON map data...");
        if(loadingIndicator) loadingIndicator.textContent = 'Loading Map Data...';
        const geoJsonUrlWithCacheBust = CONFIG.geoJsonUrl + '?cachebust=' + new Date().getTime();
        const geoJsonMapResponse = await fetch(geoJsonUrlWithCacheBust);
        if(!geoJsonMapResponse.ok) {
            const errStat = geoJsonMapResponse.status; let errBody = "GeoJSON err unreadable"; try{errBody = await geoJsonMapResponse.text()}catch(e){}
            console.error("GeoJSON fetch error:", errStat, errBody); throw new Error('GeoJSON fetch failed: ' + errStat);
        }
        const geoJsonData = await geoJsonMapResponse.json();
        if (geoJsonLayer) map.removeLayer(geoJsonLayer);
        
        geoJsonLayer = L.geoJSON(geoJsonData, { 
            style: feature => ({ 
                color: getColorForScore(feature.properties.score), weight: 2, opacity: currentGlobalLineOpacity, 
                fillColor: getColorForScore(feature.properties.score), fillOpacity: currentGlobalFillOpacity 
            }), 
            onEachFeature: (feature, layer) => {
                if (!feature || !feature.properties) { return; }
                
                layer.on('click', function(e) {
                    L.DomEvent.stopPropagation(e); 
                    clickedOnFeature = true; 
                    let panelTitle = feature.properties.label || 'Area Details';
                    let panelHTML = ""; 
                    panelHTML += `<b>Potential Visibility (next 2 hrs): ${currentTnrScore.toFixed(1)}%</b><br>`; 
                    const tnrDescription = getTnrScoreDescription(currentTnrScore); 
                    if (tnrDescription) { 
                        panelHTML += `<strong>${tnrDescription}</strong><br>`;
                    }
                    const featureLastUpdatedProperty = 'geojson_last_updated'; 
                    if (feature.properties && feature.properties[featureLastUpdatedProperty]) { 
                        try { const featureUpdateTime = new Date(feature.properties[featureLastUpdatedProperty]); 
                              panelHTML += `(Region data updated: ${featureUpdateTime.toLocaleTimeString()})<br>`; 
                        } catch (parseErr) { panelHTML += `(Region data update time unavailable)<br>`; }
                    } else if (currentTnrLastUpdated) { 
                        panelHTML += `(Visibility Index updated: ${currentTnrLastUpdated.toLocaleTimeString()})<br>`; 
                    }
                    panelHTML += `<small><em>This is real world potential visibility, taking into account solar and lunar influence, e.g., if the sun is up or if the moon is up and how bright the moon is. This makes this localized to the West Coast.</em></small><br><br>`;
                    if (feature.properties && typeof feature.properties.score !== 'undefined' && feature.properties.score !== null) { 
                        panelHTML += `Potential Aurora Visibility with no Solar or Lunar Influence: <b>${feature.properties.score}%</b><br>`; 
                        panelHTML += `<small><em>This controls the height of potential visibility and is what's to be used for nationwide forecast. Note, this doesn't take into account lunar or solar influence.</em></small>`;
                    } else { panelHTML += `Local potential data (no solar/lunar influence) N/A.`; }
                    
                    showInfoPanel(panelTitle, panelHTML);
                });
                layer.on({
                  mouseover: function (e) { if (isTouchDevice) return; const l = e.target; l.setStyle({ weight: 3, color: '#ffffff', opacity: Math.min(1, currentGlobalLineOpacity + 0.2), fillOpacity: Math.min(0.85, currentGlobalFillOpacity + 0.25)}); if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) l.bringToFront(); },
                  mouseout: function (e) { if (isTouchDevice) return; if (geoJsonLayer) geoJsonLayer.resetStyle(e.target); }
                });
              }
        }).addTo(map);
        if (lastUpdatedElementInLegend) {
            lastUpdatedElementInLegend.textContent = 'Aurora Data updated at: ' + new Date().toLocaleTimeString();
        }
      } catch (error) { 
        console.error("--- loadGeoJSON: CRITICAL ERROR IN CATCH BLOCK ---", error);
        if (lastUpdatedElementInLegend) { lastUpdatedElementInLegend.textContent = 'Aurora Data: Error.'; }
        if(auroraStatusBannerElement){
            auroraStatusBannerElement.innerHTML = "<b>Map Data Error.</b> Please try again later.";
            auroraStatusBannerElement.className = 'warning';
        }
      } finally { 
        if(loadingIndicator) loadingIndicator.style.display = 'none';
      }
    } 

    const LegendControl = L.Control.extend({
        options: { position: 'bottomright' },
        onAdd: function (mapCtrl) {
            const container = L.DomUtil.create('div', 'info legend leaflet-control'); 
            const toggleButton = L.DomUtil.create('div', 'legend-toggle', container);
            toggleButton.innerHTML = '☰ Legend';
            const content = L.DomUtil.create('div', 'legend-content', container);
            content.innerHTML = '<strong>Local Region Color Guide</strong>'; 
            const items = [
                { score: 5, text: '< 10% (Little/No Activity)' }, { score: 15, text: '10% - 24.99% (Minimal)' },
                { score: 30, text: '25% - 39.99% (Clear in Camera)' }, { score: 45, text: '40% - 49.99% (Faint Naked Eye)' },
                { score: 65, text: '50% - 79.99% (Good Naked Eye)' }, { score: 85, text: '80%+ (High Probability)' }
            ];
            items.forEach(item => {
                const itemDiv = L.DomUtil.create('div', 'legend-item', content);
                const swatch = L.DomUtil.create('i', '', itemDiv); swatch.style.background = getColorForScore(item.score);
                const textSpan = L.DomUtil.create('span', '', itemDiv); textSpan.innerHTML = item.text;
            });
            lastUpdatedElementInLegend = L.DomUtil.create('div', 'legend-last-updated', content); 
            lastUpdatedElementInLegend.textContent = 'Aurora Data initializing...';
            L.DomEvent.on(toggleButton, 'click', function (e) { L.DomEvent.stopPropagation(e); if (L.DomUtil.hasClass(container, 'expanded')) { L.DomUtil.removeClass(container, 'expanded'); } else { L.DomUtil.addClass(container, 'expanded'); } });
            L.DomEvent.disableClickPropagation(container); L.DomEvent.disableScrollPropagation(container);
            return container;
        },
        onRemove: function(mapCtrl) { lastUpdatedElementInLegend = null; } 
    });
    new LegendControl().addTo(map);

    map.on('click', function(e) {
        if (infoBottomPanelElement && infoBottomPanelElement.classList.contains('visible')) {
            const panelRect = infoBottomPanelElement.getBoundingClientRect();
            if (e.originalEvent.clientX < panelRect.left || e.originalEvent.clientX > panelRect.right ||
                e.originalEvent.clientY < panelRect.top || e.originalEvent.clientY > panelRect.bottom) {
                 hideInfoPanel();
            }
        }
        
        setTimeout(() => {
            if (!clickedOnFeature && infoBottomPanelElement && !infoBottomPanelElement.classList.contains('visible')) { 
                const genericMessage = "Aurora activity is not expected in this area or north of this area in the next hour. Conditions must get better for some auroral activity to pick up.";
                showInfoPanel("General Information", `<p>${genericMessage}</p>`);
            }
            clickedOnFeature = false; 
        }, 0); 
    });
    
    loadGeoJSON();
    setInterval(loadGeoJSON, CONFIG.refreshInterval); 

}); // End of DOMContentLoaded listener