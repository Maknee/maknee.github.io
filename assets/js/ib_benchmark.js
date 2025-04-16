// benchmark.js - Jekyll asset for InfiniBand benchmarks
function initInfiniBandPlot(plotId, benchmarkData, options = {}) {
    // Get the plot container element
    const plotContainer = document.getElementById(plotId);
    
    // Set default options
    const defaults = {
        defaultTest: 'send_bw',
        viewMode: '3d'
    };
    
    // Merge defaults and options
    const config = { ...defaults, ...options };
    
    // State management
    const state = {
        testType: config.defaultTest,
        viewMode: config.viewMode,
        activePanels: new Map(),
        panelCounter: 0
    };
    
    // Add panels indicator
    const containerIdParts = plotId.split('-');
    const instanceId = containerIdParts[containerIdParts.length - 1];
    const panelsIndicator = document.getElementById(`ib-panels-indicator-${instanceId}`);
    const panelCountElement = document.getElementById(`ib-panel-count-${instanceId}`);

    // Helper function to format throughput with appropriate units
    function formatThroughput(throughputMBps) {
        if (throughputMBps >= 1000) {
            return {
                value: throughputMBps / 1000,
                unit: 'GB/s'
            };
        } else {
            return {
                value: throughputMBps,
                unit: 'MB/s'
            };
        }
    }

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
    
   // Function to get color based on metric type
   function getColorForMetric(metricType) {
        const colors = {
            p50: 'rgb(66, 153, 225)',    // Blue for Typical/P50
            latency: 'rgb(56, 161, 105)',    // Green for Average
            p99: 'rgb(237, 137, 54)',        // Orange for 99th percentile
            p99_9: 'rgb(159, 122, 234)',     // Purple for 99.9th percentile
            max: 'rgb(229, 62, 62)'          // Red for Maximum
        };
        
        return colors[metricType] || 'rgb(0, 0, 0)';
    }

    // Function to update the visualization
    function updateVisualization() {
        const { testType, viewMode } = state;
        
        if (!benchmarkData[testType]) {
            console.error(`No data for test type: ${testType}`);
            plotContainer.innerHTML = '<div class="ib-error">No data available for this test type.</div>';
            return;
        }
        
        // Extract data points for the selected test type
        const dataPoints = [];
        
        // In real implementation, parse the benchmark data structure
        for (const msgSize in benchmarkData[testType]) {
            if (benchmarkData[testType][msgSize]) {
                const entry = benchmarkData[testType][msgSize];
                dataPoints.push({
                    messageSize: parseInt(msgSize),
                    throughput: entry.bandwidth_mbps,
                    latency: entry.latency,
                    p50: entry.latency_50,
                    p99: entry.latency_99,
                    p99_9: entry.latency_999,
                    max: entry.latency_max,
                    min: entry.latency_min,
                });
            }
        }
        
        // Sort by message size for proper line connections
        dataPoints.sort((a, b) => a.messageSize - b.messageSize);
        
        // Find min/max values for scaling
        let minLatency = Infinity;
        let maxLatency = -Infinity;
        let minThroughput = Infinity;
        let maxThroughput = -Infinity;
        
        for (const point of dataPoints) {
            if (point.latency < minLatency) minLatency = point.latency;
            if (point.latency > maxLatency) maxLatency = point.latency;
            if (point.throughput < minThroughput) minThroughput = point.throughput;
            if (point.throughput > maxThroughput) maxThroughput = point.throughput;
        }

        // for (const point of dataPoints) {
        //     // Check all latency metrics
        //     for (const metric of ['min', 'p50', 'latency', 'p99', 'p99_9', 'max']) {
        //         if (point[metric] > maxLatency) maxLatency = point[metric];
        //         if (point[metric] < minLatency) minLatency = point[metric];
        //     }
        // }

        // Format units for display
        const latencyFormat = formatLatency(maxLatency);
        const throughputFormat = formatThroughput(maxThroughput);
        
        // Create the appropriate visualization based on view mode
        if (viewMode === '3d') {
            create3DVisualization(dataPoints, latencyFormat, throughputFormat, minLatency, maxLatency, minThroughput, maxThroughput);
        } else {
            create2DMultiMetricLatencyVisualization(dataPoints, latencyFormat, minLatency, maxLatency);
            // create2DVisualization(dataPoints, latencyFormat, throughputFormat, minLatency, maxLatency, minThroughput, maxThroughput);
        }
    }
    
    // Function to create a 3D visualization
    function create3DVisualization(dataPoints, latencyFormat, throughputFormat, minLatency, maxLatency, minThroughput, maxThroughput) {
        // Convert values to appropriate units
        const latencyDivisor = latencyFormat.unit === 's' ? 1000000 : 
                             latencyFormat.unit === 'ms' ? 1000 : 1;
        
        const throughputDivisor = throughputFormat.unit === 'GB/s' ? 1000 : 1;
        
        // Determine color metric based on test type
        // For latency tests, lower latency (blue) is better
        // For bandwidth tests, higher bandwidth (red) is better
        const isLatencyTest = state.testType.includes('lat');
        
        let colorValues = [];
        let minValue, maxValue;
        
        if (isLatencyTest) {
            // Use latency values for coloring (lower is better)
            colorValues = dataPoints.map(p => p.latency);
            minValue = minLatency;
            maxValue = maxLatency;
            // Normalize and invert values (so lower latency = higher value = red)
            colorValues = colorValues.map(v => ((v - minValue) / (maxValue - minValue || 1)));
        } else {
            // Use throughput values for coloring (higher is better)
            colorValues = dataPoints.map(p => p.throughput);
            minValue = minThroughput;
            maxValue = maxThroughput;
            // Normalize values (higher throughput = higher value = red)
            colorValues = colorValues.map(v => (v - minValue) / (maxValue - minValue || 1));
        }
        
        // Modify axes placement based on test type
        // Message Size is always on Y-axis
        // For latency tests, Latency is on Z-axis and Throughput on X-axis
        // For bandwidth tests, Throughput is on Z-axis and Latency on X-axis
        let xValues, zValues;
        let xTitle, zTitle;
        let xUnit, zUnit;
        let hoverlabelX, hoverlabelZ;
        
        if (isLatencyTest) {
            // For latency tests, primary metric (latency) goes on Z-axis
            xValues = dataPoints.map(p => p.throughput / throughputDivisor);
            zValues = dataPoints.map(p => p.latency / latencyDivisor);
            xTitle = `Throughput (${throughputFormat.unit})`;
            zTitle = `Latency (${latencyFormat.unit})`;
            xUnit = throughputFormat.unit;
            zUnit = latencyFormat.unit;
            hoverlabelX = `Throughput: %{x:.2f} ${throughputFormat.unit}<br>`;
            hoverlabelZ = `Latency: %{z:.2f} ${latencyFormat.unit}<br>`;
        } else {
            // For bandwidth tests, primary metric (throughput) goes on Z-axis
            xValues = dataPoints.map(p => p.latency / latencyDivisor);
            zValues = dataPoints.map(p => p.throughput / throughputDivisor);
            xTitle = `Latency (${latencyFormat.unit})`;
            zTitle = `Throughput (${throughputFormat.unit})`;
            xUnit = latencyFormat.unit;
            zUnit = throughputFormat.unit;
            hoverlabelX = `Latency: %{x:.2f} ${latencyFormat.unit}<br>`;
            hoverlabelZ = `Throughput: %{z:.2f} ${throughputFormat.unit}<br>`;
        }
        
        // Create colorscale for the colorbar
        const colorscale = [
            [0, 'rgb(0, 0, 255)'],      // Blue
            [0.25, 'rgb(0, 255, 255)'],  // Cyan
            [0.5, 'rgb(0, 255, 0)'],     // Green
            [0.75, 'rgb(255, 165, 0)'],  // Orange
            [1, 'rgb(255, 0, 0)']        // Red
        ];
        
        // Prepare data for the 3D scatter plot
        const trace1 = {
            type: 'scatter3d',
            mode: 'markers',
            name: 'Data Points',
            x: xValues,
            y: dataPoints.map(p => p.messageSize), // Message Size always on Y-axis
            z: zValues,
            text: dataPoints.map(p => `Message Size: ${p.messageSize} bytes`),
            hovertemplate:
                'Message Size: %{y} bytes<br>' +
                hoverlabelX +
                hoverlabelZ,
            marker: {
                size: 8,
                color: colorValues,
                colorscale: colorscale,
                showscale: false
            }
        };
        
        // Add a line connecting the points
        const trace2 = {
            type: 'scatter3d',
            mode: 'lines',
            name: 'Trend Line',
            x: xValues,
            y: dataPoints.map(p => p.messageSize),
            z: zValues,
            line: {
                color: 'rgba(100, 100, 100, 0.8)',
                width: 2
            },
            hoverinfo: 'none'
        };
        
        // Generate tick values for colorbar
        const colorMetricMin = isLatencyTest ? minLatency / latencyDivisor : minThroughput / throughputDivisor;
        const colorMetricMax = isLatencyTest ? maxLatency / latencyDivisor : maxThroughput / throughputDivisor;
        const colorMetricRange = colorMetricMax - colorMetricMin;
        
        const tickVals = [0, 0.25, 0.5, 0.75, 1];
        const tickText = tickVals.map(val => {
            const metricVal = (colorMetricMin + val * colorMetricRange).toFixed(2);
            return metricVal;
        });
        
        // Add a colorbar reference trace
        const trace3 = {
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
                title: isLatencyTest ? `Latency (${latencyFormat.unit})` : `Throughput (${throughputFormat.unit})`,
                thickness: 15,
                x: 1.1,
                y: 0.5,
                yanchor: 'middle',
                tickvals: tickVals,
                ticktext: tickText
            },
            visible: true,
            hoverinfo: 'none'
        };
        
        // Create the 3D layout
        const layout = {
            title: `${state.testType.toUpperCase()} Benchmark: Message Size vs ${isLatencyTest ? 'Latency' : 'Throughput'}`,
            scene: {
                xaxis: {
                    title: xTitle,
                    type: isLatencyTest ? 'linear' : 'log', // Log scale for latency
                    backgroundcolor: "rgb(245, 245, 245)",
                    gridcolor: "rgb(220, 220, 220)",
                    showbackground: true
                },
                yaxis: {
                    title: 'Message Size (bytes)',
                    type: 'log',
                    backgroundcolor: "rgb(245, 245, 245)",
                    gridcolor: "rgb(220, 220, 220)",
                    showbackground: true
                },
                zaxis: {
                    title: zTitle,
                    type: !isLatencyTest ? 'linear' : 'log', // Log scale for latency
                    backgroundcolor: "rgb(245, 245, 245)",
                    gridcolor: "rgb(220, 220, 220)",
                    showbackground: true
                },
                camera: {
                    eye: { x: 1.5, y: -1.5, z: 1.2 }
                },
                aspectratio: { x: 1, y: 1, z: 1 }
            },
            legend: {
                x: 0,
                y: 1.05,
                orientation: 'h'
            },
            margin: {
                l: 0,
                r: 80, // More space on the right for the color bar
                b: 0,
                t: 50,
                pad: 4
            },
            autosize: true
        };
        
        // Create the plot
        Plotly.newPlot(plotContainer, [trace1, trace2, trace3], layout, {
            responsive: true,
            displaylogo: false
        });
        
        // Add click handler for detailed view
        plotContainer.on('plotly_click', function(data) {
            const point = data.points[0];
            // Get the original data point that was clicked
            const clickedPointIndex = point.pointNumber;
            const originalPoint = dataPoints[clickedPointIndex];
            
            if (originalPoint) {
                showDetailPanel(originalPoint);
            }
        });
    }
    
    // Function to create a 2D visualization
    function create2DVisualization(dataPoints, latencyFormat, throughputFormat, minLatency, maxLatency, minThroughput, maxThroughput) {
        // Convert values to appropriate units
        const latencyDivisor = latencyFormat.unit === 's' ? 1000000 : 
                             latencyFormat.unit === 'ms' ? 1000 : 1;
        
        const throughputDivisor = throughputFormat.unit === 'GB/s' ? 1000 : 1;
        
        // Determine color metric based on test type
        // For latency tests, lower latency (blue) is better
        // For bandwidth tests, higher bandwidth (red) is better
        const isLatencyTest = state.testType.includes('lat');
        
        let colorValues = [];
        let minValue, maxValue;
        
        if (isLatencyTest) {
            // Use latency values for coloring (lower is better)
            colorValues = dataPoints.map(p => p.latency);
            minValue = minLatency;
            maxValue = maxLatency;
            // Normalize and invert values (so lower latency = higher value = red)
            colorValues = colorValues.map(v => ((v - minValue) / (maxValue - minValue || 1)));
        } else {
            // Use throughput values for coloring (higher is better)
            colorValues = dataPoints.map(p => p.throughput);
            minValue = minThroughput;
            maxValue = maxThroughput;
            // Normalize values (higher throughput = higher value = red)
            colorValues = colorValues.map(v => (v - minValue) / (maxValue - minValue || 1));
        }
        
        // Modify axes placement based on test type
        // Message Size is now on X-axis (flipped)
        // For latency tests, Y-axis is Latency
        // For bandwidth tests, Y-axis is Throughput
        let yValues, yTitle, yUnit;
        
        if (isLatencyTest) {
            // For latency tests, Y-axis is the primary metric (latency)
            yValues = dataPoints.map(p => p.latency / latencyDivisor);
            yTitle = `Latency (${latencyFormat.unit})`;
            yUnit = latencyFormat.unit;
        } else {
            // For bandwidth tests, Y-axis is the primary metric (throughput)
            yValues = dataPoints.map(p => p.throughput / throughputDivisor);
            yTitle = `Throughput (${throughputFormat.unit})`;
            yUnit = throughputFormat.unit;
        }
        
        // Create colorscale for the colorbar
        const colorscale = [
            [0, 'rgb(0, 0, 255)'],      // Blue
            [0.25, 'rgb(0, 255, 255)'],  // Cyan
            [0.5, 'rgb(0, 255, 0)'],     // Green
            [0.75, 'rgb(255, 165, 0)'],  // Orange
            [1, 'rgb(255, 0, 0)']        // Red
        ];
        
        // Prepare data for the 2D scatter plot
        const trace1 = {
            type: 'scatter',
            mode: 'markers',
            name: 'Data Points',
            x: dataPoints.map(p => p.messageSize), // Message Size now on X-axis
            y: yValues,
            text: dataPoints.map(p => {
                if (isLatencyTest) {
                    return `Throughput: ${p.throughput.toFixed(2)} MB/s`;
                } else {
                    return `Latency: ${p.latency.toFixed(2)} μs`;
                }
            }),
            hovertemplate:
                'Message Size: %{x} bytes<br>' +
                `${isLatencyTest ? 'Latency' : 'Throughput'}: %{y:.2f} ${yUnit}<br>` +
                '%{text}<br>',
            marker: {
                size: 12,
                color: colorValues,
                colorscale: colorscale,
                showscale: false
            }
        };
        
        // Add a line connecting the points
        const trace2 = {
            type: 'scatter',
            mode: 'lines',
            name: 'Trend Line',
            x: dataPoints.map(p => p.messageSize),
            y: yValues,
            line: {
                color: 'rgba(100, 100, 100, 0.5)',
                width: 2
            },
            hoverinfo: 'none'
        };
        
        // Generate tick values for colorbar
        const colorMetricMin = isLatencyTest ? minLatency / latencyDivisor : minThroughput / throughputDivisor;
        const colorMetricMax = isLatencyTest ? maxLatency / latencyDivisor : maxThroughput / throughputDivisor;
        const colorMetricRange = colorMetricMax - colorMetricMin;
        
        const tickVals = [0, 0.25, 0.5, 0.75, 1];
        const tickText = tickVals.map(val => {
            const metricVal = (colorMetricMin + val * colorMetricRange).toFixed(2);
            return metricVal;
        });
        
        // Add a colorbar reference trace
        const trace3 = {
            type: 'heatmap',  // Using heatmap for 2D colorbar
            z: [[0]],  // Dummy data
            visible: false,  // This trace is only for the colorbar
            colorscale: colorscale,
            showscale: true,
            colorbar: {
                title: isLatencyTest ? `Latency (${latencyFormat.unit})` : `Throughput (${throughputFormat.unit})`,
                thickness: 15,
                x: 1.05,
                y: 0.5,
                yanchor: 'middle',
                tickvals: tickVals,
                ticktext: tickText
            }
        };
        
        // Create the 2D layout
        const layout = {
            title: `${state.testType.toUpperCase()} Benchmark: Message Size vs ${isLatencyTest ? 'Latency' : 'Throughput'}`,
            xaxis: {
                title: 'Message Size (bytes)',
                type: 'log',
                gridcolor: "rgb(220, 220, 220)"
            },
            yaxis: {
                title: yTitle,
                type: isLatencyTest ? 'log' : 'linear', // Log scale for latency
                gridcolor: "rgb(220, 220, 220)"
            },
            legend: {
                x: 0,
                y: 1.15,
                orientation: 'h'
            },
            margin: {
                l: 60,
                r: 80, // More space on the right for the color bar
                b: 60,
                t: 80, // Increased top margin to accommodate the legend
                pad: 4
            },
            autosize: true
        };
        
        // Create the plot
        Plotly.newPlot(plotContainer, [trace1, trace2, trace3], layout, {
            responsive: true,
            displaylogo: false
        });
        
        // Add click handler for detailed view
        plotContainer.on('plotly_click', function(data) {
            const point = data.points[0];
            // Get the original data point that was clicked
            const clickedPointIndex = point.pointNumber;
            const originalPoint = dataPoints[clickedPointIndex];
            
            if (originalPoint) {
                showDetailPanel(originalPoint);
            }
        });
    }

    function create2DMultiMetricLatencyVisualization(dataPoints, latencyFormat, minLatency, maxLatency) {
        // Clear previous plot
        plotContainer.innerHTML = '';
        
        // Convert values to appropriate units
        const latencyDivisor = latencyFormat.unit === 's' ? 1000000 : 
                             latencyFormat.unit === 'ms' ? 1000 : 1;
        
        // Determine if this is a latency or bandwidth test
        const isLatencyTest = state.testType.includes('lat');
        
        // Find min/max values for throughput (for color scaling)
        let minThroughput = Infinity;
        let maxThroughput = -Infinity;
        
        for (const point of dataPoints) {
            if (point.throughput < minThroughput) minThroughput = point.throughput;
            if (point.throughput > maxThroughput) maxThroughput = point.throughput;
        }
        
        // Define what to display based on test type
        let metrics, yTitle, yUnit;
        
        if (isLatencyTest) {
            // For latency tests, show different latency metrics
            metrics = [
                { key: 'p50', name: '50th Percentile' },
                { key: 'latency', name: 'Average' },
                { key: 'p99', name: '99th Percentile' },
                { key: 'p99_9', name: '99.9th Percentile' },
                { key: 'max', name: 'Maximum' }
            ];
            yTitle = `Latency (${latencyFormat.unit})`;
            yUnit = latencyFormat.unit;
        } else {
            // For bandwidth tests, we'll use a color gradient instead of multiple metrics
            metrics = [];
            yTitle = 'Throughput (MB/s)';
            yUnit = 'MB/s';
        }
        
        // Create traces for the plot
        let traces = [];
        
        // For latency tests, create multiple lines for different metrics
        if (isLatencyTest) {
            traces = metrics.map(metric => {
                return {
                    type: 'scatter',
                    mode: 'lines+markers',
                    name: metric.name,
                    x: dataPoints.map(p => p.messageSize),
                    y: dataPoints.map(p => p[metric.key] / latencyDivisor),
                    line: {
                        color: getColorForMetric(metric.key),
                        width: metric.key === 'latency' ? 3 : 2
                    },
                    marker: {
                        size: metric.key === 'latency' ? 6 : 4,
                        color: getColorForMetric(metric.key)
                    },
                    hovertemplate:
                        'Message Size: %{x} bytes<br>' +
                        `${metric.name}: %{y:.2f} ${yUnit}<br>`
                };
            });
        } else {
            // For bandwidth tests, create a single line with a color gradient
            // Create colorscale for the points
            const colorscale = [
                [0, 'rgb(0, 0, 255)'],      // Blue
                [0.25, 'rgb(0, 255, 255)'],  // Cyan
                [0.5, 'rgb(0, 255, 0)'],     // Green
                [0.75, 'rgb(255, 165, 0)'],  // Orange
                [1, 'rgb(255, 0, 0)']        // Red
            ];
            
            // Calculate color values from the throughput
            let colorValues = [];
            let customData = [];
            
            for (const point of dataPoints) {
                // Normalize values (higher throughput = higher value = red)
                const normalizedValue = (point.throughput - minThroughput) / (maxThroughput - minThroughput || 1);
                colorValues.push(normalizedValue);
                
                // Store latency for hover text
                customData.push({
                    latency: point.latency.toFixed(2)
                });
            }
            
            // Create a trace with markers colored by throughput
            traces.push({
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Throughput',
                x: dataPoints.map(p => p.messageSize),
                y: dataPoints.map(p => p.throughput),
                customdata: customData,
                line: {
                    color: 'rgba(100, 100, 100, 0.5)',
                    width: 2
                },
                marker: {
                    size: 10,
                    color: colorValues,
                    colorscale: colorscale,
                    showscale: true,
                    colorbar: {
                        title: 'Throughput (MB/s)',
                        thickness: 15,
                        x: 1.05,
                        y: 0.5,
                        yanchor: 'middle'
                    }
                },
                hovertemplate:
                    'Message Size: %{x} bytes<br>' +
                    'Throughput: %{y:.2f} MB/s<br>' +
                    'Latency: %{customdata.latency} μs<extra></extra>'
            });
        }
        
        // Create the 2D layout
        const layout = {
            title: `${state.testType.toUpperCase()} Benchmark: ${isLatencyTest ? 'Latency Metrics' : 'Throughput vs Message Size'}`,
            xaxis: {
                title: 'Message Size (bytes)',
                type: 'log',
                gridcolor: "rgb(220, 220, 220)"
            },
            yaxis: {
                title: yTitle,
                type: isLatencyTest ? 'log' : 'linear', // Log scale for latency, linear for throughput
                gridcolor: "rgb(220, 220, 220)"
            },
            legend: {
                x: 0,
                y: 1.15,
                orientation: 'h'
            },
            margin: {
                l: 60,
                r: isLatencyTest ? 40 : 80, // More space on the right for throughput colorbar
                b: 60,
                t: 100,
                pad: 4
            },
            hovermode: 'closest',
            autosize: true,
        };
        
        // Create the plot
        Plotly.newPlot(plotContainer, traces, layout, {
            responsive: true,
            displaylogo: false
        });
        
        // Add click handler for detailed view
        plotContainer.on('plotly_click', function(data) {
            const point = data.points[0];
            // Get the original data point that was clicked
            const clickedPointIndex = point.pointNumber;
            const originalPoint = dataPoints[clickedPointIndex];
            
            if (originalPoint) {
                showDetailPanel(originalPoint);
            }
        });
    }
    
    // Function to show a detail panel for a specific data point
    function showDetailPanel(dataPoint) {
        console.log("Showing detail panel for:", dataPoint);
        
        // Generate a unique panel ID
        const uniquePanelId = `panel-${instanceId}-${state.panelCounter++}`;
        
        // Create a new panel element
        const panel = document.createElement('div');
        panel.id = uniquePanelId;
        panel.className = 'ib-draggable-panel';
        panel.innerHTML = `
            <div class="ib-panel-header">
                <h3 class="ib-panel-title">Message Size: ${dataPoint.messageSize} bytes</h3>
                <div class="ib-panel-controls">
                    <button class="ib-collapse-btn" title="Collapse">▲</button>
                    <button class="ib-close-btn" title="Close">×</button>
                </div>
            </div>
            <div class="ib-panel-content">
                <div class="ib-panel-details">
                    <p><strong>Test Type:</strong> ${state.testType}</p>
                    <p><strong>Message Size:</strong> ${dataPoint.messageSize} bytes</p>
                    <p><strong>Latency:</strong> ${dataPoint.latency.toFixed(2)} μs</p>
                    <p><strong>Throughput:</strong> ${dataPoint.throughput.toFixed(2)} MB/s</p>
                </div>
                <div class="ib-panel-plot"></div>
            </div>
        `;
        
        // Calculate panel position
        const containerRect = plotContainer.getBoundingClientRect();
        panel.style.left = `${Math.max(20, containerRect.width / 4)}px`;
        panel.style.top = `${Math.max(20, containerRect.height / 4)}px`;
        panel.style.width = '400px';
        panel.style.height = '350px';
        panel.style.display = 'block';
        
        // Add panel to the container
        document.body.appendChild(panel);
        
        // Store in active panels
        state.activePanels.set(uniquePanelId, panel);
        
        // Set up event handlers for the panel
        setupPanelEventHandlers(panel, uniquePanelId);
        
        // Create a plot in the panel
        const plotDiv = panel.querySelector('.ib-panel-plot');
        createDetailPlot(plotDiv, dataPoint);
        
        // Update panel count
        updatePanelCount();
    }
    
    // Function to show a detail panel for a specific data point
    function showDetailPanel(dataPoint) {
        console.log("Showing detail panel for:", dataPoint);
        
        // Generate a unique panel ID
        const uniquePanelId = `panel-${instanceId}-${state.panelCounter++}`;
        
        // Create a new panel element
        const panel = document.createElement('div');
        panel.id = uniquePanelId;
        panel.className = 'ib-draggable-panel';
        panel.innerHTML = `
            <div class="ib-panel-header">
                <h3 class="ib-panel-title">Message Size: ${dataPoint.messageSize} bytes</h3>
                <div class="ib-panel-controls">
                    <button class="ib-collapse-btn" title="Collapse">▲</button>
                    <button class="ib-close-btn" title="Close">×</button>
                </div>
            </div>
            <div class="ib-panel-content">
                <div class="ib-panel-details">
                    <p><strong>Test Type:</strong> ${state.testType}</p>
                    <p><strong>Message Size:</strong> ${dataPoint.messageSize} bytes</p>
                    <p><strong>Minimum Latency:</strong> ${dataPoint.min.toFixed(2)} μs</p>
                    <p><strong>50th Percentile:</strong> ${dataPoint.p50.toFixed(2)} μs</p>
                    <p><strong>Average Latency:</strong> ${dataPoint.latency.toFixed(2)} μs</p>
                    <p><strong>99th Percentile:</strong> ${dataPoint.p99.toFixed(2)} μs</p>
                    <p><strong>99.9th Percentile:</strong> ${dataPoint.p99_9.toFixed(2)} μs</p>
                    <p><strong>Maximum Latency:</strong> ${dataPoint.max.toFixed(2)} μs</p>
                </div>
                <div class="ib-panel-plot"></div>
            </div>
        `;
        
        // Calculate panel position
        const containerRect = plotContainer.getBoundingClientRect();
        panel.style.left = `${Math.max(20, containerRect.width / 4)}px`;
        panel.style.top = `${Math.max(20, containerRect.height / 4)}px`;
        panel.style.width = '450px';
        panel.style.height = '400px';
        panel.style.display = 'block';
        
        // Add panel to the container
        document.body.appendChild(panel);
        
        // Store in active panels
        state.activePanels.set(uniquePanelId, panel);
        
        // Set up event handlers for the panel
        setupPanelEventHandlers(panel, uniquePanelId);
        
        // Create a plot in the panel
        const plotDiv = panel.querySelector('.ib-panel-plot');
        createDetailPlot(plotDiv, dataPoint);
        
        // Update panel count
        updatePanelCount();
    }

    // Function to set up event handlers for a panel
    function setupPanelEventHandlers(panel, panelId) {
        const panelHeader = panel.querySelector('.ib-panel-header');
        const closeBtn = panel.querySelector('.ib-close-btn');
        const collapseBtn = panel.querySelector('.ib-collapse-btn');
        
        // Make panel draggable
        setupDraggable(panel, panelHeader);
        
        // Close button handler
        closeBtn.addEventListener('click', () => {
            panel.remove();
            state.activePanels.delete(panelId);
            updatePanelCount();
        });
        
        // Collapse button handler
        collapseBtn.addEventListener('click', () => {
            panel.classList.toggle('ib-panel-collapsed');
            collapseBtn.textContent = panel.classList.contains('ib-panel-collapsed') ? '▼' : '▲';
            
            // Trigger resize to update plots if expanded
            if (!panel.classList.contains('ib-panel-collapsed')) {
                setTimeout(() => {
                    window.dispatchEvent(new Event('resize'));
                }, 300);
            }
        });
    }

    // Function to make a panel draggable
    function setupDraggable(panel, handle) {
        let isDragging = false;
        let startX, startY;
        
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isDragging = true;
            
            const panelRect = panel.getBoundingClientRect();
            startX = e.clientX - panelRect.left;
            startY = e.clientY - panelRect.top;
            
            handle.style.cursor = 'grabbing';
            
            // Bring panel to front
            state.activePanels.forEach(p => {
                p.style.zIndex = (p === panel) ? '1000' : '999';
            });
        });
        
        const moveHandler = (e) => {
            if (!isDragging) return;
            
            const newLeft = e.clientX - startX;
            const newTop = e.clientY - startY;
            
            panel.style.left = `${newLeft}px`;
            panel.style.top = `${newTop}px`;
        };
        
        const upHandler = () => {
            if (isDragging) {
                isDragging = false;
                handle.style.cursor = 'move';
            }
        };
        
        document.addEventListener('mousemove', moveHandler);
        document.addEventListener('mouseup', upHandler);
        
        // Store handlers to remove them later
        panel._moveHandler = moveHandler;
        panel._upHandler = upHandler;
    }
    
    // Function to create a detail plot in the panel
    function createDetailPlot(plotDiv, dataPoint) {
        // Here we would create a plot showing additional details
        // For example, a comparison with other message sizes
        // This is a placeholder implementation
        
        const trace = {
            type: 'bar',
            x: ['Latency (μs)', 'Throughput (MB/s)'],
            y: [dataPoint.latency, Math.min(dataPoint.throughput, 100)], // Scale throughput for visibility
            marker: {
                color: ['rgba(50, 50, 200, 0.7)', 'rgba(200, 50, 50, 0.7)']
            }
        };
        
        const layout = {
            title: `Performance Metrics (${dataPoint.messageSize} bytes)`,
            margin: {
                l: 40,
                r: 10,
                t: 30,
                b: 40
            },
            height: 220,
            autosize: true
        };
        
        Plotly.newPlot(plotDiv, [trace], layout, {
            displayModeBar: false,
            responsive: true
        });
    }
    
    // Update panel count display
    function updatePanelCount() {
        const count = state.activePanels.size;
        panelCountElement.textContent = count;
        panelsIndicator.style.display = count > 0 ? 'block' : 'none';
    }
    
    // Set up event handlers for panels indicator
    document.getElementById(`ib-arrange-btn-${instanceId}`).addEventListener('click', arrangeAllPanels);
    document.getElementById(`ib-close-all-btn-${instanceId}`).addEventListener('click', closeAllPanels);
    
    // Arrange all panels in a grid
    function arrangeAllPanels() {
        if (state.activePanels.size === 0) return;
        
        const containerWidth = window.innerWidth;
        const containerHeight = window.innerHeight;
        const maxPanelsPerRow = Math.min(3, state.activePanels.size);
        const rows = Math.ceil(state.activePanels.size / maxPanelsPerRow);
        
        const panelWidth = Math.min(450, containerWidth / maxPanelsPerRow - 20);
        const panelHeight = Math.min(400, containerHeight / rows - 20);
        
        // Define starting positions
        const startX = 20;
        const startY = 20;
        
        let index = 0;
        state.activePanels.forEach(panel => {
            const row = Math.floor(index / maxPanelsPerRow);
            const col = index % maxPanelsPerRow;
            
            panel.style.top = `${startY + (row * panelHeight)}px`;
            panel.style.left = `${startX + (col * panelWidth)}px`;
            panel.style.width = `${panelWidth}px`;
            panel.style.height = `${panelHeight}px`;
            
            panel.classList.remove('ib-panel-collapsed');
            panel.querySelector('.ib-collapse-btn').textContent = '▲';
            
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
            }, 300);
            
            index++;
        });
    }
    
    // Close all panels
    function closeAllPanels() {
        state.activePanels.forEach((panel, id) => {
            panel.remove();
            state.activePanels.delete(id);
        });
        updatePanelCount();
    }
    
    // Set test type and update visualization
    function setTestType(newTestType) {
        if (benchmarkData[newTestType]) {
            state.testType = newTestType;
            updateVisualization();
        } else {
            console.error(`Test type '${newTestType}' is not available in the data.`);
        }
    }
    
    // Set view mode and update visualization
    function setViewMode(newViewMode) {
        if (newViewMode === '2d' || newViewMode === '3d') {
            state.viewMode = newViewMode;
            updateVisualization();
        } else {
            console.error(`View mode '${newViewMode}' is not supported. Use '2d' or '3d'.`);
        }
    }
    
    // Initialize the visualization
    updateVisualization();
    
    // Return public API
    return {
        updateVisualization,
        setTestType,
        setViewMode
    };
}

// Process benchmark data from JSON format to a usable structure
function processBenchmarkData(rawData) {
    const processedData = {};
    
    // Check if rawData has the expected structure
    if (!rawData || !rawData.results) {
        console.error('Invalid benchmark data format');
        return {};
    }
    
    // Process each test type
    for (const testType in rawData.results) {
        const testData = rawData.results[testType];
        
        // Create an entry for this test type
        processedData[testType] = {};
        
        // Check if the test results are available
        if (!testData || !testData.results || !Array.isArray(testData.results)) {
            continue;
        }
        
        // Process each data point
        testData.results.forEach(dataPoint => {
            const messageSize = dataPoint.bytes;
            
            // // Extract data based on test type
            // if (testType.includes('lat')) {
            //     // For latency tests, extract all latency metrics
            //     processedData[testType][messageSize] = {
            //         message_size: messageSize,
            //         latency_min_usec: dataPoint.latency_min_usec,
            //         latency_typical_usec: dataPoint.latency_typical_usec,
            //         latency_avg_usec: dataPoint.latency_avg_usec,
            //         latency_99percentile_usec: dataPoint.latency_99percentile_usec,
            //         'latency_99.9percentile_usec': dataPoint['latency_99.9percentile_usec'],
            //         latency_max_usec: dataPoint.latency_max_usec,
            //     };
            // } else if (testType.includes('bw')) {
            //     // For bandwidth tests, extract bandwidth metrics
            //     processedData[testType][messageSize] = {
            //         message_size: messageSize,
            //         bandwidth_mbps: dataPoint.bw_average_MBs,
            //         bw_peak_mbps: dataPoint.bw_peak_MBs,
            //         msg_rate_mpps: dataPoint.msg_rate_Mpps || 0
            //     };
            // }

            // Extract latency and bandwidth based on test type
            let latency, bandwidth, latency_min, latency_max, latency_50, latency_99, latency_999;
            
            if (testType.includes('lat')) {
                // Latency test - use latency_avg_usec
                latency = dataPoint.latency_avg_usec;
                latency_min = dataPoint.latency_min_usec;
                latency_max = dataPoint.latency_max_usec,
                latency_50 = dataPoint.latency_typical_usec;
                latency_99 = dataPoint.latency_99percentile_usec;
                latency_999 = dataPoint['latency_99.9percentile_usec'];

                // For latency tests, calculate implied bandwidth
                // Formula: bandwidth = message_size / latency
                // Convert bytes to megabytes and microseconds to seconds
                if (latency > 0) {
                    bandwidth = (messageSize / (1024 * 1024)) / (latency / 1000000);
                } else {
                    bandwidth = 0;
                }
            } else if (testType.includes('bw')) {
                // Bandwidth test - use bw_average_MBs directly
                bandwidth = dataPoint.bw_average_MBs;
                
                // For bandwidth tests, calculate implied latency
                // Formula: latency = message_size / bandwidth
                // Convert MB/s to B/s and seconds to microseconds
                if (bandwidth > 0) {
                    latency = (messageSize / (bandwidth * 1024 * 1024)) * 1000000;
                } else {
                    latency = 0;
                }
            }
            
            // Store the processed data point
            processedData[testType][messageSize] = {
                message_size: messageSize,
                latency: latency,
                bandwidth_mbps: bandwidth,
                msg_rate_mpps: dataPoint.msg_rate_Mpps || 0,
                latency_min: latency_min || 0,
                latency_max: latency_max || 0,
                latency_50: latency_50 || 0,
                latency_99: latency_99 || 0,
                latency_999: latency_999 || 0,
            };
        });
    }
    
    return processedData;
}
