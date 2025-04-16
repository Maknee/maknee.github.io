// benchmark.js - Jekyll asset
function initBenchmarkPlot(instanceId) {
    // Define our grid dimensions
    const iodepths = [1, 2, 4, 8, 16, 32, 64, 128];
    const numjobs = [1, 2, 4, 8, 16];

    // Get the benchmark data for this instance
    const benchmarkData = window['benchmarkData_' + instanceId];

    // Global references for interactive elements
    const plotContainer = document.getElementById('benchmark-plot-' + instanceId);
    const latencyPanel = document.getElementById('latencyPanel-' + instanceId);
    const panelHeader = document.getElementById('panelHeader-' + instanceId);
    const latencyDetailsDiv = document.getElementById('latencyDetails-' + instanceId);
    const latencyPlotDiv = document.getElementById('latencyPlot-' + instanceId);
    const closeLatencyBtn = document.getElementById('closeLatencyBtn-' + instanceId);
    const collapseBtn = document.getElementById('collapseBtn-' + instanceId);
    const panelTitle = document.getElementById('panelTitle-' + instanceId);
    
    // Add active panels indicator and controls
    const panelsIndicator = document.createElement('div');
    panelsIndicator.id = 'activePanelsIndicator-' + instanceId;
    panelsIndicator.className = 'active-panels-indicator';
    panelsIndicator.innerHTML = `
        <span id="panelCount-${instanceId}">0</span> active latency panels
        <button id="closeAllPanelsBtn-${instanceId}" class="action-button">Close All</button>
        <button id="arrangeAllPanelsBtn-${instanceId}" class="action-button">Arrange</button>
    `;
    document.body.appendChild(panelsIndicator);
    
    const panelCountElement = document.getElementById('panelCount-' + instanceId);
    const closeAllPanelsBtn = document.getElementById('closeAllPanelsBtn-' + instanceId);
    const arrangeAllPanelsBtn = document.getElementById('arrangeAllPanelsBtn-' + instanceId);
    
    // Use the correct IDs for the select elements
    const testTypeSelect = document.getElementById('testType-' + instanceId);
    const metricTypeSelect = document.getElementById('metricType-' + instanceId);
    
    // Counter for creating multiple panels
    let panelCounter = 0;
    
    // Storage for all created panels
    const activePanels = new Map();
    
    // Panel positions - use this to offset new panels
    const panelPositions = {
      lastTop: 100,
      lastLeft: 30,
      increment: 30
    };
    
    // Update panel count display
    function updatePanelCount() {
      const count = activePanels.size;
      panelCountElement.textContent = count;
      panelsIndicator.style.display = count > 0 ? 'block' : 'none';
    }
    
    // Close all panels
    closeAllPanelsBtn.addEventListener('click', () => {
      activePanels.forEach((panel, id) => {
        panel.remove();
        activePanels.delete(id);
      });
      updatePanelCount();
    });
    
    // Arrange all panels in a grid
    arrangeAllPanelsBtn.addEventListener('click', () => {
      if (activePanels.size === 0) return;
      
      // Calculate grid dimensions
      const containerWidth = window.innerWidth;
      const containerHeight = window.innerHeight;
      const maxPanelsPerRow = Math.min(3, activePanels.size);
      const rows = Math.ceil(activePanels.size / maxPanelsPerRow);
      const cols = Math.min(maxPanelsPerRow, activePanels.size);
      
      // Calculate panel size
      const panelWidth = 600;
      const panelHeight = 450;
      
      // Calculate starting position
      const startX = Math.max(20, (containerWidth - (cols * panelWidth)) / 2);
      const startY = Math.max(60, (containerHeight - (rows * panelHeight)) / 2);
      
      let index = 0;
      activePanels.forEach(panel => {
        const row = Math.floor(index / cols);
        const col = index % cols;
        
        panel.style.top = `${startY + (row * panelHeight)}px`;
        panel.style.left = `${startX + (col * panelWidth)}px`;
        panel.style.width = `${panelWidth}px`;
        panel.style.height = `${panelHeight}px`;
        
        // Make sure panel is not collapsed
        panel.classList.remove('panel-collapsed');
        panel.querySelector('.collapse-btn').textContent = '▲';
        
        // Trigger resize to update plot
        setTimeout(() => {
          window.dispatchEvent(new Event('resize'));
        }, 300);
        
        index++;
      });
    });
    
    // Helper function to format latency with appropriate units
    function formatLatency(latencyMicros) {
      if (latencyMicros >= 1000000) {
        return {
          value: latencyMicros / 1000000,
          unit: 's'
        };
      } else if (latencyMicros >= 1000) {
        return {
          value: latencyMicros / 1000,
          unit: 'ms'
        };
      } else {
        return {
          value: latencyMicros,
          unit: 'μs'
        };
      }
    }
    
    // Function to create a new latency panel
    function createLatencyPanel(iodepth, numjob, testType) {
      // Generate a unique panel ID
      const uniquePanelId = `${instanceId}-panel-${iodepth}-${numjob}-${panelCounter++}`;
      
      // Create a new panel element
      const panel = document.createElement('div');
      panel.id = uniquePanelId;
      panel.className = 'benchmark-draggable-panel';
      panel.innerHTML = `
        <div class="panel-header">
          <h3 class="panel-title">Latency - IO Depth: ${iodepth}, Jobs: ${numjob}</h3>
          <div class="panel-controls">
            <button class="collapse-btn" title="Collapse">▲</button>
            <button class="close-btn" title="Close">×</button>
          </div>
        </div>
        <div class="panel-content">
          <div class="latency-details"></div>
          <div class="latency-plot-container"></div>
        </div>
      `;
      
      // Find the benchmark container or use document.body as fallback
      const benchmarkContainer = document.querySelector(`.benchmark-container:has(#benchmark-plot-${instanceId})`) || document.body;
      
      // Calculate position relative to container
      const containerRect = benchmarkContainer.getBoundingClientRect();
      const containerScrollTop = benchmarkContainer.scrollTop || 0;
      const containerScrollLeft = benchmarkContainer.scrollLeft || 0;
      
      // Position panel in the center of visible container area
      const containerVisibleWidth = containerRect.width;
      const containerVisibleHeight = Math.min(containerRect.height, window.innerHeight);
      
      // Set initial position
      panel.style.left = `${Math.max(30, (containerVisibleWidth - 420) / 2)}px`;
      panel.style.top = `${Math.max(50, (containerVisibleHeight - 400) / 4) + containerScrollTop}px`;
      panel.style.width = '420px';
      panel.style.height = '400px';
      panel.style.display = 'block';
      panel.style.zIndex = '1000';
      
      // Add panel to container
      benchmarkContainer.appendChild(panel);
      
      // Update positions for next panel
      panelPositions.lastTop += panelPositions.increment;
      panelPositions.lastLeft += panelPositions.increment;
      
      // Reset positions if they go too far
      if (panelPositions.lastTop > 300) panelPositions.lastTop = 100;
      if (panelPositions.lastLeft > 700) panelPositions.lastLeft = 30;
      
      // Store in active panels
      activePanels.set(uniquePanelId, panel);
      
      // Set up event handlers for the new panel
      const panelHeader = panel.querySelector('.panel-header');
      const closeBtn = panel.querySelector('.close-btn');
      const collapseBtn = panel.querySelector('.collapse-btn');
      const detailsDiv = panel.querySelector('.latency-details');
      const plotDiv = panel.querySelector('.latency-plot-container');
      
      // Close button handler
      closeBtn.addEventListener('click', () => {
        panel.remove();
        activePanels.delete(uniquePanelId);
        updatePanelCount();
      });
      
      // Toggle collapse state
      collapseBtn.addEventListener('click', () => {
        panel.classList.toggle('panel-collapsed');
        collapseBtn.textContent = panel.classList.contains('panel-collapsed') ? '▼' : '▲';
        collapseBtn.title = panel.classList.contains('panel-collapsed') ? 'Expand' : 'Collapse';
        
        // Trigger a resize to update plots if expanded
        if (!panel.classList.contains('panel-collapsed')) {
          setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
          }, 300);
        }
      });
      
      // Make this panel draggable
      setupDraggable(panel, panelHeader);
      
      // Update panel count
      updatePanelCount();
      
      return { panel, detailsDiv, plotDiv };
    }
    
    // Function to set up draggable behavior for a panel
    function setupDraggable(panel, panelHeader) {
      let isDragging = false;
      let startX, startY;
      
      panelHeader.addEventListener('mousedown', (e) => {
        // Prevent default to avoid text selection during drag
        e.preventDefault();
        
        isDragging = true;
        
        // Calculate the initial offset of the mouse within the panel
        const panelRect = panel.getBoundingClientRect();
        startX = e.clientX - panelRect.left;
        startY = e.clientY - panelRect.top;
        
        panelHeader.style.cursor = 'grabbing';
        
        // Bring this panel to front
        activePanels.forEach(p => {
          p.style.zIndex = (p === panel) ? '1000' : '999';
        });
      });
      
      const moveHandler = (e) => {
        if (!isDragging) return;
        
        // Get container's position for offset calculation
        const containerRect = panel.parentElement.getBoundingClientRect();
        
        // Calculate new position relative to the container
        const newLeft = e.clientX - containerRect.left - startX;
        const newTop = e.clientY - containerRect.top - startY;
        
        // Apply the new position
        panel.style.left = `${newLeft}px`;
        panel.style.top = `${newTop}px`;
        
        // // Keep panel within container bounds
        // const containerWidth = panel.parentElement.clientWidth;
        // const containerHeight = panel.parentElement.clientHeight;
        
        // if (parseInt(panel.style.left) < 0) panel.style.left = '0px';
        // if (parseInt(panel.style.top) < 0) panel.style.top = '0px';
        
        // const maxX = containerWidth - panel.offsetWidth;
        // const maxY = containerHeight - panel.offsetHeight;
        
        // if (maxX > 0 && parseInt(panel.style.left) > maxX) panel.style.left = `${maxX}px`;
        // if (maxY > 0 && parseInt(panel.style.top) > maxY) panel.style.top = `${maxY}px`;
      };
      
      const upHandler = () => {
        if (isDragging) {
          isDragging = false;
          panelHeader.style.cursor = 'move';
        }
      };
      
      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', upHandler);
      
      // Store these handlers on the panel to properly remove them when the panel is closed
      panel._moveHandler = moveHandler;
      panel._upHandler = upHandler;
    }

    // Function to show latency percentiles for a specific configuration
    function showLatencyPercentiles(iodepth, numjob, testType) {
      console.log(`Showing latency for iodepth:${iodepth}, jobs:${numjob}, test:${testType}`);
      
      // Get the data for this configuration
      if (!benchmarkData[testType] || !benchmarkData[testType][iodepth] || !benchmarkData[testType][iodepth][numjob]) {
        console.error('No data available for this configuration');
        return;
      }
      
      const data = benchmarkData[testType][iodepth][numjob];
      
      if (!data || !data.percentiles) {
        console.error('No percentile data available for this configuration');
        return;
      }
      
      // Create a new panel
      const { panel, detailsDiv, plotDiv } = createLatencyPanel(iodepth, numjob, testType);
      
      // Format the average latency with appropriate units
      const formattedLatency = formatLatency(data.latency_us);
      const formattedP50 = formatLatency(data.percentiles.p50 || 0);
      const formattedP90 = formatLatency(data.percentiles.p90 || 0);
      const formattedP99 = formatLatency(data.percentiles.p99 || 0);
      
      // Update the details text
      detailsDiv.innerHTML = `
        <p><strong>Test Type:</strong> ${testType} | <strong>IO Depth:</strong> ${iodepth} | <strong>Number of Jobs:</strong> ${numjob}</p>
        <p><strong>Average Latency:</strong> ${formattedLatency.value.toFixed(2)} ${formattedLatency.unit}</p>
        <p><strong>p50:</strong> ${formattedP50.value.toFixed(2)} ${formattedP50.unit} | 
           <strong>p90:</strong> ${formattedP90.value.toFixed(2)} ${formattedP90.unit} | 
           <strong>p99:</strong> ${formattedP99.value.toFixed(2)} ${formattedP99.unit}</p>
      `;
      
      // Find all jobs for this iodepth
      const availableJobs = [];
      if (benchmarkData[testType] && benchmarkData[testType][iodepth]) {
        for (const job in benchmarkData[testType][iodepth]) {
          if (benchmarkData[testType][iodepth][job]) {
            availableJobs.push(parseInt(job));
          }
        }
      }
      
      availableJobs.sort((a, b) => a - b);
      
      // Create dataset for each percentile
      const p50Values = [];
      const p90Values = [];
      const p99Values = [];
      const meanValues = [];
      const xValues = [];
      
      let maxLatency = 0;
      
      for (const job of availableJobs) {
        const configData = benchmarkData[testType][iodepth][job];
        if (configData && configData.percentiles) {
          xValues.push(job);
          p50Values.push(configData.percentiles.p50 || 0);
          p90Values.push(configData.percentiles.p90 || 0);
          p99Values.push(configData.percentiles.p99 || 0);
          meanValues.push(configData.latency_us); // Use average latency
          
          // Track maximum latency for unit determination
          maxLatency = Math.max(maxLatency, 
            configData.percentiles.p50 || 0, 
            configData.percentiles.p90 || 0,
            configData.percentiles.p99 || 0,
            configData.latency_us
          );
        }
      }
      
      // Determine appropriate unit for the graph based on max value
      const latencyFormat = formatLatency(maxLatency);
      const divisor = latencyFormat.unit === 's' ? 1000000 : 
                     latencyFormat.unit === 'ms' ? 1000 : 1;
      
      // Convert all values to the appropriate unit
      const p50ValuesConverted = p50Values.map(val => val / divisor);
      const p90ValuesConverted = p90Values.map(val => val / divisor);
      const p99ValuesConverted = p99Values.map(val => val / divisor);
      const meanValuesConverted = meanValues.map(val => val / divisor);
      
      // Create the chart
      const data50 = {
        x: xValues,
        y: p50ValuesConverted,
        type: 'scatter',
        mode: 'lines+markers',
        name: 'p50 (50th percentile)',
        line: { width: 3, color: '#4285F4' },
        hovertemplate: 'Jobs: %{x}<br>p50: %{y:.2f} ' + latencyFormat.unit + '<extra></extra>'
      };
      
      const data90 = {
        x: xValues,
        y: p90ValuesConverted,
        type: 'scatter',
        mode: 'lines+markers',
        name: 'p90 (90th percentile)',
        line: { width: 3, color: '#34A853' },
        hovertemplate: 'Jobs: %{x}<br>p90: %{y:.2f} ' + latencyFormat.unit + '<extra></extra>'
      };
      
      const data99 = {
        x: xValues,
        y: p99ValuesConverted,
        type: 'scatter',
        mode: 'lines+markers',
        name: 'p99 (99th percentile)',
        line: { width: 3, color: '#FBBC05' },
        hovertemplate: 'Jobs: %{x}<br>p99: %{y:.2f} ' + latencyFormat.unit + '<extra></extra>'
      };
      
      const dataMean = {
        x: xValues,
        y: meanValuesConverted,
        type: 'scatter',
        mode: 'lines+markers',
        name: 'Average',
        line: { width: 3, color: '#EA4335', dash: 'dot' },
        hovertemplate: 'Jobs: %{x}<br>Average: %{y:.2f} ' + latencyFormat.unit + '<extra></extra>'
      };
      
      const layout = {
        title: '',
        xaxis: {
          title: 'Number of Jobs',
          type: 'log',
          autorange: true
        },
        yaxis: {
          title: `Latency (${latencyFormat.unit})`,
          exponentformat: 'none'
        },
        legend: {
          orientation: 'h',
          y: -0.4,
          xanchor: 'center',
          x: 0.5,
        },
        hovermode: 'closest',
        margin: { t: 5, l: 60, r: 5, b: 90 },
        autosize: true,
        height: 250,
      };
      
      Plotly.newPlot(plotDiv, [data50, data90, data99, dataMean], layout, {
        responsive: true,
        displayModeBar: false
      });
      
      // Handle window resize for this specific panel
      const resizeHandler = () => {
        if (panel.style.display === 'block' && !panel.classList.contains('panel-collapsed')) {
          Plotly.relayout(plotDiv, { autosize: true });
        }
      };
      
      window.addEventListener('resize', resizeHandler);
      
      // Store the handler to remove it when the panel is closed
      panel._resizeHandler = resizeHandler;
    }

    // Create a 3D bar with specified position and size
    function createBar(x, y, z, width, depth, height, color) {
      // Define the 8 vertices of the cube
      const vertices = [
        // Bottom face
        [x, y, 0],               // 0: bottom front left
        [x + width, y, 0],       // 1: bottom front right
        [x + width, y + depth, 0], // 2: bottom back right
        [x, y + depth, 0],       // 3: bottom back left
        // Top face
        [x, y, height],          // 4: top front left
        [x + width, y, height],  // 5: top front right
        [x + width, y + depth, height], // 6: top back right
        [x, y + depth, height]   // 7: top back left
      ];

      // Define the 12 triangles (2 per face * 6 faces)
      const indices = [
        // Bottom face
        [0, 1, 2], [0, 2, 3],
        // Top face
        [4, 6, 5], [4, 7, 6],
        // Front face
        [0, 4, 1], [1, 4, 5],
        // Back face
        [2, 6, 3], [3, 6, 7],
        // Left face
        [0, 3, 4], [3, 7, 4],
        // Right face
        [1, 5, 2], [2, 5, 6]
      ];

      // Extract x, y, z coordinates
      const xs = vertices.map(v => v[0]);
      const ys = vertices.map(v => v[1]);
      const zs = vertices.map(v => v[2]);

      // Create i, j, k arrays for the triangles
      const i = [];
      const j = [];
      const k = [];

      for (const triangle of indices) {
        i.push(triangle[0]);
        j.push(triangle[1]);
        k.push(triangle[2]);
      }

      // Apply a single color to all faces
      const colors = Array(indices.length).fill(color);

      return { xs, ys, zs, i, j, k, colors };
    }

    // Function to get color based on normalized value (0-1)
    function getColorFromValue(value) {
      // Define color stops from blue (low) to red (high)
      const colorStops = [
        { pos: 0, color: [0, 0, 255] },     // Blue
        { pos: 0.25, color: [0, 255, 255] }, // Cyan
        { pos: 0.5, color: [0, 255, 0] },    // Green
        { pos: 0.75, color: [255, 165, 0] },  // Orange
        { pos: 1, color: [255, 0, 0] }        // Red
      ];

      // Find the two stops to interpolate between
      let lowStop = colorStops[0];
      let highStop = colorStops[1];

      for (let i = 1; i < colorStops.length; i++) {
        if (value <= colorStops[i].pos) {
          lowStop = colorStops[i-1];
          highStop = colorStops[i];
          break;
        }

        if (i === colorStops.length - 1) {
          lowStop = colorStops[i-1];
          highStop = colorStops[i];
        }
      }

      // Calculate the interpolation factor
      const factor = (value - lowStop.pos) / (highStop.pos - lowStop.pos);

      // Interpolate between the colors
      const r = Math.round(lowStop.color[0] + factor * (highStop.color[0] - lowStop.color[0]));
      const g = Math.round(lowStop.color[1] + factor * (highStop.color[1] - lowStop.color[1]));
      const b = Math.round(lowStop.color[2] + factor * (highStop.color[2] - lowStop.color[2]));

      return `rgb(${r}, ${g}, ${b})`;
    }

    // Application state
    const state = {
        // Default values - can be overridden during initialization
        testType: testTypeSelect.value || 'randread',
        selectedMetric: metricTypeSelect.value || 'bandwidth'
    };

    // Set a specific default if needed
    function setDefaults(defaultTestType, defaultMetric) {
        if (defaultTestType && benchmarkData[defaultTestType]) {
            state.testType = defaultTestType;
            testTypeSelect.value = defaultTestType;
        }
        
        if (defaultMetric) {
            state.selectedMetric = defaultMetric;
            metricTypeSelect.value = defaultMetric;
        }
    }

    // Event handlers
    testTypeSelect.addEventListener('change', e => {
        state.testType = e.target.value;
        updateVisualization();
    });

    metricTypeSelect.addEventListener('change', e => {
        state.selectedMetric = e.target.value;
        updateVisualization();
    });
    
    // Handle window resize events for all plots
    window.addEventListener('resize', () => {
        activePanels.forEach(panel => {
            if (panel.style.display === 'block' && !panel.classList.contains('panel-collapsed')) {
                const plotElement = panel.querySelector('.latency-plot-container');
                if (plotElement) {
                    Plotly.relayout(plotElement, {
                        autosize: true
                    });
                }
            }
        });
        
        // Also resize the main plot
        if (plotContainer) {
            Plotly.relayout(plotContainer, { autosize: true });
        }
    });

    // Create and update the visualization
    function updateVisualization() {
        const { testType, selectedMetric } = state;

        if (!benchmarkData[testType]) {
            console.error(`No data for test type: ${testType}`);
            return;
        }

        const metricMap = {
            'bandwidth': 'bandwidth_gb',
            'iops': 'iops',
            'latency': 'latency_us',
            'latency_p50': 'percentiles.p50',
            'latency_p90': 'percentiles.p90',
            'latency_p99': 'percentiles.p99'
        };

        const metricKey = metricMap[selectedMetric];
        const testData = benchmarkData[testType];

        // Map data to arrays for better access
        const dataPoints = [];
        
        for (const iodepth in testData) {
            for (const job in testData[iodepth]) {
                if (testData[iodepth][job]) {
                    // Handle nested properties for percentiles
                    let value;
                    if (metricKey.includes('.')) {
                        const [obj, prop] = metricKey.split('.');
                        value = testData[iodepth][job][obj] ? testData[iodepth][job][obj][prop] : null;
                    } else {
                        value = testData[iodepth][job][metricKey];
                    }
                    
                    if (value !== undefined && value !== null) {
                        dataPoints.push({
                            iodepth: parseInt(iodepth),
                            job: parseInt(job),
                            value: value
                        });
                    }
                }
            }
        }

        // Find the maximum value for scaling
        let minValue = Infinity;
        let maxValue = -Infinity;
        
        for (const point of dataPoints) {
            if (point.value < minValue) minValue = point.value;
            if (point.value > maxValue) maxValue = point.value;
        }

        // Define plot data
        const plotData = [];

        // Bar width and depth (slightly less than 1 to create gaps)
        const barWidth = 0.75;
        const barDepth = 0.75;

        // Find the indices for each iodepth and job
        const uniqueIodepths = [...new Set(dataPoints.map(p => p.iodepth))].sort((a, b) => a - b);
        const uniqueJobs = [...new Set(dataPoints.map(p => p.job))].sort((a, b) => a - b);
        
        // For latency metrics, determine the appropriate units based on the maximum value
        let metricUnit = '';
        
        switch (selectedMetric) {
            case 'bandwidth':
                metricUnit = 'GB/s';
                break;
            case 'iops':
                metricUnit = 'IOPS';
                break;
            case 'latency':
            case 'latency_p50':
            case 'latency_p90':
            case 'latency_p99':
                const formattedLatency = formatLatency(maxValue);
                metricUnit = formattedLatency.unit;
                
                // Convert the values to the appropriate unit
                const divisor = metricUnit === 's' ? 1000000 : 
                               metricUnit === 'ms' ? 1000 : 1;
                                
                for (let point of dataPoints) {
                    point.value = point.value / divisor;
                }
                
                // Recalculate min/max
                minValue = Math.min(...dataPoints.map(p => p.value));
                maxValue = Math.max(...dataPoints.map(p => p.value));
                break;
        }
        
        // Human-readable metric name for display
        let metricName = selectedMetric.replace('_', ' ');
        metricName = metricName.charAt(0).toUpperCase() + metricName.slice(1);
        
        // Create the data for each bar
        for (const point of dataPoints) {
            const i = uniqueIodepths.indexOf(point.iodepth);
            const j = uniqueJobs.indexOf(point.job);
            
            if (i !== -1 && j !== -1) {
                const normalizedValue = (point.value - minValue) / (maxValue - minValue);
                const color = getColorFromValue(normalizedValue);

                // Create the 3D bar
                const bar = createBar(i, j, 0, barWidth, barDepth, point.value, color);

                // Create hover text
                const hoverText = `IO Depth: ${point.iodepth}<br>Jobs: ${point.job}<br>${metricName}: ${point.value.toFixed(2)} ${metricUnit}<br>Click for latency percentiles`;

                // Create mesh3d object
                plotData.push({
                    type: 'mesh3d',
                    x: bar.xs,
                    y: bar.ys,
                    z: bar.zs,
                    i: bar.i,
                    j: bar.j,
                    k: bar.k,
                    facecolor: bar.colors,
                    flatshading: true,
                    hoverinfo: 'text',
                    text: Array(bar.xs.length).fill(hoverText),
                    customdata: Array(bar.xs.length).fill({ 
                        iodepth: point.iodepth, 
                        job: point.job 
                    })
                });
            }
        }

        // Create colorscale for the colorbar
        const colorscale = [
            [0, 'rgb(0, 0, 255)'],      // Blue
            [0.25, 'rgb(0, 255, 255)'],  // Cyan
            [0.5, 'rgb(0, 255, 0)'],     // Green
            [0.75, 'rgb(255, 165, 0)'],  // Orange
            [1, 'rgb(255, 0, 0)']        // Red
        ];

        // Add a colorbar reference trace
        plotData.push({
            type: 'mesh3d',
            x: [0],
            y: [0],
            z: [0],
            i: [0],
            j: [0],
            k: [0],
            intensity: [0, 1],
            colorscale: colorscale,
            showscale: true,
            colorbar: {
                title: metricUnit,
                x: 1.05,
                xanchor: 'left',
                tickvals: [0, 0.25, 0.5, 0.75, 1],
                ticktext: [
                    minValue.toFixed(1), 
                    ((maxValue - minValue) * 0.25 + minValue).toFixed(1), 
                    ((maxValue - minValue) * 0.5 + minValue).toFixed(1), 
                    ((maxValue - minValue) * 0.75 + minValue).toFixed(1), 
                    maxValue.toFixed(1)
                ]
            },
            visible: true,
            hoverinfo: 'none'
        });
        
        // Subtitle text
        let blockType = '';
        switch (selectedMetric) {
            case 'bandwidth':
                blockType = 'type bw';
                break;
            case 'iops':
                blockType = 'type iops';
                break;
            case 'latency':
                blockType = 'type lat';
                break;
            case 'latency_p50':
                blockType = 'type lat (p50)';
                break;
            case 'latency_p90':
                blockType = 'type lat (p90)';
                break;
            case 'latency_p99':
                blockType = 'type lat (p99)';
                break;
        }
        
        // Get operation type (read or write)
        const opType = testType.includes('write') ? 'write' : 'read';

        // Create layout
        const layout = {
            title: {
                text: `FIO ${testType} Thread Scaling`,
                font: { size: 16 }
            },
            annotations: [
                {
                    text: `| rw ${testType} | ${blockType} | filter ${opType} |`,
                    xref: 'paper',
                    yref: 'paper',
                    x: 0.5,
                    y: 1.02,
                    xanchor: 'center',
                    yanchor: 'bottom',
                    showarrow: false,
                    font: { size: 12 }
                }
            ],
            scene: {
                xaxis: {
                    title: 'iodepth',
                    tickvals: [...Array(uniqueIodepths.length).keys()],
                    ticktext: uniqueIodepths.map(String),
                    showspikes: false
                },
                yaxis: {
                    title: 'numjobs',
                    tickvals: [...Array(uniqueJobs.length).keys()],
                    ticktext: uniqueJobs.map(String),
                    showspikes: false
                },
                zaxis: {
                    title: metricUnit,
                    showspikes: false,
                },
                camera: {
                    eye: { x: 1.75, y: -1.75, z: 1.5 },
                    center: { x: 0, y: 0, z: 0 }
                },
                aspectratio: { x: 1.2, y: 1.2, z: 0.85 }
            },
            margin: {
                l: 0,
                r: 0,
                b: 30,
                t: 60,
                pad: 0
            },
            autosize: true,
            height: 450
        };

        // Create the plot
        Plotly.newPlot(plotContainer, plotData, layout, {
            responsive: true,
            displayModeBar: true,
            displaylogo: false
        });
        
        // Add click event to show latency information
        plotContainer.on('plotly_click', function(data) {
            const point = data.points[0];
            console.log('Clicked point:', point);
            
            try {
                // Check if we have customdata with the correct iodepth and job values
                if (point.customdata && point.customdata.iodepth !== undefined && point.customdata.job !== undefined) {
                    // Use the custom data directly from the point
                    const iodepth = point.customdata.iodepth;
                    const job = point.customdata.job;
                    console.log(`Using customdata: iodepth=${iodepth}, job=${job}`);
                    showLatencyPercentiles(iodepth, job, state.testType);
                } else {
                    // Fallback to position-based lookup
                    const x = Math.round(point.x);
                    const y = Math.round(point.y);
                    console.log(`Using position-based lookup: x=${x}, y=${y}`);
                    
                    // Find the corresponding iodepth and numjob values
                    const iodepth = uniqueIodepths[x];
                    const job = uniqueJobs[y];
                    
                    if (iodepth !== undefined && job !== undefined) {
                        console.log(`Found values: iodepth=${iodepth}, job=${job}`);
                        showLatencyPercentiles(iodepth, job, state.testType);
                    } else {
                        console.error('Could not determine iodepth and job values from click');
                    }
                }
            } catch (err) {
                console.error('Error handling click event:', err);
            }
        });
    }

    // Initialize the visualization
    updateVisualization();
    
    // Return an API to expose functionality
    return {
        updateVisualization,
        setDefaults
    };
}