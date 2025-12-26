import React, { useEffect, useState, useRef, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './App.css';

interface TelemetryData {
  timestamp: number;
  speed: number;
  battery: number;
  power: number;
  gear: string;
  odometer: number;
  heading: number;
  received_at: string;
  vehicle_vin?: string;  // Last 6 digits of VIN for multi-vehicle support
}

interface CompressionDataPoint {
  timestamp: number;
  compression_ratio: number;
  transmitted: number;
  skipped: number;
}

interface LogMessage {
  timestamp: string;
  message: string;
  type?: 'info' | 'success' | 'error' | 'warning';
}

interface CompressionStats {
  total_readings: number;
  transmitted_readings: number;
  skipped_readings: number;
  compression_ratio: number;
}

interface WebSocketMessage {
  type: 'history' | 'telemetry' | 'log';
  data?: TelemetryData | TelemetryData[];
  message?: string;
  log_type?: 'info' | 'success' | 'error' | 'warning';
  compression_stats?: CompressionStats;
  vehicle_vin?: string;  // Vehicle identifier for multi-vehicle support
}

function App() {
  // Backend URL from environment variable (localhost for dev, Cloud Run for production)
  const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';
  const WS_URL = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');

  const [telemetryData, setTelemetryData] = useState<TelemetryData[]>([]);
  const [compressionHistory, setCompressionHistory] = useState<CompressionDataPoint[]>([]);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isScriptRunning, setIsScriptRunning] = useState(false);
  const [initialOdometer, setInitialOdometer] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showCompressionInfo, setShowCompressionInfo] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [selectedVehicle, setSelectedVehicle] = useState<string>('all');  // 'all' or VIN suffix
  const [compressionStats, setCompressionStats] = useState<CompressionStats>({
    total_readings: 0,
    transmitted_readings: 0,
    skipped_readings: 0,
    compression_ratio: 0
  });
  const wsRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const maxDataPoints = 200;
  const maxLogs = 100;

  // Auto-scroll terminal to bottom
  useEffect(() => {
    if (terminalRef.current && shouldAutoScroll.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  const addLog = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => {
      const newLogs = [...prev, { timestamp, message, type }];
      return newLogs.slice(-maxLogs);
    });
  };

  const connectWebSocket = () => {
    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebSocket(`${WS_URL}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
      addLog('WebSocket connected to server', 'success');
      addLog('=== Tesla Telemetry Dashboard Online ===', 'info');
    };

    ws.onmessage = (event) => {
      const message: WebSocketMessage = JSON.parse(event.data);
      console.log('[Dashboard] Received WebSocket message:', message.type, 'VIN:', message.vehicle_vin);
      
      // Update compression stats if available
      if (message.compression_stats) {
        setCompressionStats(message.compression_stats);
        
        // Add to compression history for charting
        if (message.type === 'telemetry') {
          const newData = message.data as TelemetryData;
          // Add vehicle VIN to telemetry data if provided
          if (message.vehicle_vin && newData) {
            newData.vehicle_vin = message.vehicle_vin;
          }
          setCompressionHistory(prev => {
            const updated = [...prev, {
              timestamp: newData.timestamp,
              compression_ratio: message.compression_stats!.compression_ratio,
              transmitted: message.compression_stats!.transmitted_readings,
              skipped: message.compression_stats!.skipped_readings
            }];
            return updated.slice(-maxDataPoints);
          });
        }
      }
      
      if (message.type === 'history') {
        // Initial data load - merge with existing data on reconnect
        const historyData = message.data as TelemetryData[];
        setTelemetryData(prev => {
          if (prev.length === 0) {
            return historyData.slice(-maxDataPoints);
          } else {
            // Merge and deduplicate by timestamp
            const combined = [...prev, ...historyData];
            const unique = Array.from(new Map(combined.map(item => [item.timestamp, item])).values());
            return unique.slice(-maxDataPoints);
          }
        });
        setLastUpdate(new Date());
        addLog(`Loaded ${historyData.length} historical records`, 'info');
      } else if (message.type === 'telemetry') {
        // Real-time update
        const newData = message.data as TelemetryData;
        // Add vehicle VIN to telemetry data if provided
        if (message.vehicle_vin) {
          newData.vehicle_vin = message.vehicle_vin;
          console.log('[Dashboard] Added VIN to telemetry:', message.vehicle_vin);
        } else {
          console.warn('[Dashboard] No vehicle_vin in message!');
        }
        setTelemetryData(prev => {
          const updated = [...prev, newData];
          return updated.slice(-maxDataPoints);
        });
        // Set initial odometer on first data point
        setInitialOdometer(prevInitial => prevInitial ?? newData.odometer);
        setLastUpdate(new Date());
      } else if (message.type === 'log') {
        // Server-side log message
        addLog(message.message || '', message.log_type || 'info');
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
      addLog('WebSocket connection error', 'error');
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
      addLog('WebSocket disconnected from server', 'warning');
    };
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      // Send Enter to C++ logger to toggle offline/online
      fetch(`${BACKEND_URL}/toggle_offline`, { method: 'POST' })
        .then(() => {
          setIsOnline(prev => !prev);
          addLog('Toggled offline/online mode', 'info');
        })
        .catch(err => addLog(`Toggle failed: ${err}`, 'error'));
    }
  };

  const handleToggleOffline = () => {
    // Same functionality as pressing Enter
    fetch(`${BACKEND_URL}/toggle_offline`, { method: 'POST' })
      .then(() => {
        setIsOnline(prev => !prev);
        addLog('Toggled offline/online mode', 'info');
      })
      .catch(err => addLog(`Toggle failed: ${err}`, 'error'));
  };

  const handlePlayScript = async () => {
    if (isScriptRunning) {
      // Stop script and clear data
      try {
        await fetch(`${BACKEND_URL}/stop_script`, { method: 'POST' });
        await fetch(`${BACKEND_URL}/clear_data`, { method: 'POST' });
        setIsScriptRunning(false);
        setTelemetryData([]);
        setCompressionHistory([]);
        setCompressionStats({
          total_readings: 0,
          transmitted_readings: 0,
          skipped_readings: 0,
          compression_ratio: 0
        });
        setInitialOdometer(null);
        setLastUpdate(null);
        addLog('Stopped logger script and cleared data', 'warning');
      } catch (error) {
        addLog('Failed to stop script', 'error');
      }
    } else {
      // Start script
      try {
        const response = await fetch(`${BACKEND_URL}/start_script`, { method: 'POST' });
        if (response.ok) {
          setIsScriptRunning(true);
          addLog('Started logger script', 'success');
        } else {
          addLog('Failed to start script', 'error');
        }
      } catch (error) {
        addLog('Failed to start script', 'error');
      }
    }
  };

  const handleClearData = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/clear_data`, { method: 'POST' });
      if (response.ok) {
        setTelemetryData([]);
        setCompressionHistory([]);
        setCompressionStats({
          total_readings: 0,
          transmitted_readings: 0,
          skipped_readings: 0,
          compression_ratio: 0
        });
        setInitialOdometer(null);
        setLastUpdate(null);
        addLog('Cleared all telemetry data', 'success');
      } else {
        addLog('Failed to clear data', 'error');
      }
    } catch (error) {
      addLog('Failed to clear data', 'error');
    }
  };

  useEffect(() => {
    // Check if script is already running
    fetch(`${BACKEND_URL}/status`)
      .then(res => res.json())
      .then(data => {
        if (data.script_running) {
          setIsScriptRunning(true);
        }
      })
      .catch(() => {});

    // Initial logs
    addLog('[DATABASE] Initialized telemetry_buffer.db', 'info');
    addLog('=== Store-and-Forward Tesla Telemetry System ===', 'info');
    addLog('Waiting for connection...', 'info');

    // Connect to WebSocket
    connectWebSocket();

    // Cleanup on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Format timestamp for display
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  // Convert heading degrees to compass direction
  const getCompassDirection = (degrees: number) => {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(degrees / 22.5) % 16;
    return directions[index];
  };

  // Get unique vehicle VINs from telemetry data
  const availableVehicles = useMemo(() => {
    const vins = new Set(telemetryData.map(d => d.vehicle_vin).filter(Boolean));
    const vinArray = Array.from(vins).sort();
    console.log('[Dashboard] Available vehicles:', vinArray, 'from', telemetryData.length, 'data points');
    return vinArray;
  }, [telemetryData]);

  // Filter telemetry data by selected vehicle
  const filteredData = useMemo(() => {
    if (selectedVehicle === 'all') {
      return telemetryData;
    }
    return telemetryData.filter(d => d.vehicle_vin === selectedVehicle);
  }, [telemetryData, selectedVehicle]);

  // Calculate Wh/mi and driving smoothness
  const analyticsData = useMemo(() => {
    if (filteredData.length < 2) {
      return { whPerMile: 0, smoothness: 100, avgAccel: 0 };
    }

    let totalEnergyWh = 0;
    let totalDistanceMiles = 0;
    let accelerations: number[] = [];
    let jerks: number[] = [];

    for (let i = 1; i < filteredData.length; i++) {
      const prev = filteredData[i - 1];
      const curr = filteredData[i];

      // Time delta in hours
      const timeDeltaMs = curr.timestamp - prev.timestamp;
      const timeDeltaHours = timeDeltaMs / (1000 * 60 * 60);
      
      if (timeDeltaHours > 0) {
        // Energy consumed: Power (kW) × Time (hours) = kWh, convert to Wh
        const energyWh = Math.abs(curr.power) * timeDeltaHours * 1000;
        totalEnergyWh += energyWh;

        // Distance traveled
        const distanceMiles = curr.odometer - prev.odometer;
        totalDistanceMiles += distanceMiles;

        // Calculate acceleration (mph/s)
        const timeDeltaSeconds = timeDeltaMs / 1000;
        if (timeDeltaSeconds > 0) {
          const accel = (curr.speed - prev.speed) / timeDeltaSeconds;
          accelerations.push(accel);

          // Calculate jerk (rate of change of acceleration)
          if (i > 1 && accelerations.length > 1) {
            const prevAccel = accelerations[accelerations.length - 2];
            const jerk = Math.abs((accel - prevAccel) / timeDeltaSeconds);
            jerks.push(jerk);
          }
        }
      }
    }

    const whPerMile = totalDistanceMiles > 0 ? totalEnergyWh / totalDistanceMiles : 0;
    
    // Smoothness score: lower jerk = smoother (scale 0-100)
    // Average jerk close to 0 = 100, higher jerk = lower score
    const avgJerk = jerks.length > 0 ? jerks.reduce((a, b) => a + b, 0) / jerks.length : 0;
    const smoothness = Math.max(0, Math.min(100, 100 - (avgJerk * 10))); // Scale jerk to 0-100

    const avgAccel = accelerations.length > 0 ? accelerations.reduce((a, b) => a + b, 0) / accelerations.length : 0;

    return { 
      whPerMile: Math.round(whPerMile), 
      smoothness: Math.round(smoothness),
      avgAccel: avgAccel.toFixed(2)
    };
  }, [filteredData]);

  // Transform data for charts
  const chartData = useMemo(() => {
    const baseOdometer = initialOdometer ?? (filteredData.length > 0 ? filteredData[0].odometer : 0);
    return filteredData.map((d) => {
      const odometerDelta = d.odometer - baseOdometer;
      return {
        time: formatTime(d.timestamp),
        timestamp: d.timestamp,
        speed: d.speed,
        battery: d.battery,
        power: d.power,
        odometerDelta: odometerDelta,
        heading: d.heading,
      };
    });
  }, [telemetryData, initialOdometer]);

  return (
    <div className="App">
      <header className="App-header">
        <div className="header-title">
          <h1>Tesla Model 3 Telemetry Dashboard</h1>
          <div className="header-actions">
            <a href="https://www.linkedin.com/in/soham-rajadh/" target="_blank" rel="noopener noreferrer" className="social-link" title="LinkedIn">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
              </svg>
            </a>
            <a href="https://github.com/ssrajadh/Fault-Tolerant-Tesla-Telemetry-System" target="_blank" rel="noopener noreferrer" className="social-link" title="GitHub">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
            </a>
            <button className="help-button" onClick={() => setShowHelp(true)} title="Help">
              ?
            </button>
          </div>
        </div>
        <div className="status-bar">
          <div className="status-indicator">
            <span className={`status-dot ${isConnected ? 'online' : 'offline'}`}></span>
            <span className="status-text">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          {availableVehicles.length > 0 && (
            <div className="vehicle-selector">
              <label htmlFor="vehicle-filter">Vehicle: </label>
              <select 
                id="vehicle-filter"
                value={selectedVehicle} 
                onChange={(e) => setSelectedVehicle(e.target.value)}
                className="vehicle-dropdown"
              >
                <option value="all">
                  {availableVehicles.length > 1 
                    ? `All Vehicles (${availableVehicles.length})` 
                    : 'All Vehicles'}
                </option>
                {availableVehicles.map(vin => (
                  <option key={vin} value={vin}>
                    VIN: {vin}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="data-info">
            <span>Data Points: {filteredData.length}</span>
            {selectedVehicle !== 'all' && telemetryData.length > filteredData.length && (
              <span className="filter-info"> (of {telemetryData.length} total)</span>
            )}
            {lastUpdate && (
              <span className="last-update">
                Last Update: {lastUpdate.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="dashboard-grid">
        {telemetryData.length === 0 ? (
          <>
            {/* Placeholder for charts when no data */}
            <div className="grid-item chart-container no-data-chart">
              <h2>Vehicle Speed</h2>
              <div className="waiting-message">
                <p>Click the <strong>play button (▶)</strong> in the terminal to start the logger</p>
              </div>
            </div>
            <div className="grid-item chart-container no-data-chart">
              <h2>Distance Traveled</h2>
              <div className="waiting-message">
                <p>Waiting for data...</p>
              </div>
            </div>
            <div className="grid-item chart-container no-data-chart">
              <h2>Power Usage</h2>
              <div className="waiting-message">
                <p>Waiting for data...</p>
              </div>
            </div>
            <div className="grid-item chart-container no-data-chart">
              <div className="chart-header-with-info">
                <h2>Compression Efficiency</h2>
                <button 
                  className="info-button" 
                  onClick={() => setShowCompressionInfo(true)}
                  title="About Compression"
                >
                  i
                </button>
              </div>
              <div className="waiting-message">
                <p>Waiting for data...</p>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Speed Chart */}
            <div className="grid-item chart-container">
              <h2>Vehicle Speed</h2>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="time" 
                    tick={{ fontSize: 11 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis 
                    label={{ value: 'Speed (mph)', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }}
                  />
                  <Tooltip />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="speed" 
                    stroke="#8884d8" 
                    strokeWidth={2}
                    dot={false}
                    name="Speed (mph)"
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Odometer Delta Chart */}
            <div className="grid-item chart-container">
              <h2>Distance Traveled</h2>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="time" 
                    tick={{ fontSize: 11 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis 
                    label={{ value: 'Miles', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }}
                  />
                  <Tooltip />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="odometerDelta" 
                    stroke="#82ca9d" 
                    strokeWidth={2}
                    dot={false}
                    name="Miles Traveled"
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Power Chart */}
            <div className="grid-item chart-container">
              <h2>Power Usage</h2>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="time" 
                    tick={{ fontSize: 11 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis 
                    label={{ value: 'Power (kW)', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }}
                  />
                  <Tooltip />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="power" 
                    stroke="#ff7300" 
                    strokeWidth={2}
                    dot={false}
                    name="Power (kW)"
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Compression Ratio Chart */}
            <div className="grid-item chart-container">
              <div className="chart-header-with-info">
                <h2>Compression Efficiency</h2>
                <button 
                  className="info-button" 
                  onClick={() => setShowCompressionInfo(true)}
                  title="About Compression"
                >
                  i
                </button>
              </div>
              <div className="chart-content">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={compressionHistory.map(d => ({
                  time: formatTime(d.timestamp),
                  ratio: d.compression_ratio
                }))} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="time" 
                    tick={{ fontSize: 11 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis 
                    label={{ value: 'Bandwidth Saved (%)', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }}
                    domain={[0, 100]}
                  />
                  <Tooltip />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="ratio" 
                    stroke="#38ef7d" 
                    strokeWidth={2}
                    dot={false}
                    name="Compression (%)"
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
              </div>
            </div>
          </>
        )}

        {/* Terminal Output - Always visible */}
        <div className="grid-item terminal-container" tabIndex={0} onKeyPress={handleKeyPress}>
            <div className="terminal-header">
              <h2>Logger Terminal</h2>
              <button 
                className={`play-button ${isScriptRunning ? 'running' : ''}`}
                onClick={handlePlayScript}
                title={isScriptRunning ? 'Stop script' : 'Start logger script'}
              >
                {isScriptRunning ? '■' : '▶'}
              </button>
            </div>
            <div className="terminal-output" ref={terminalRef}>
              {logs.map((log, idx) => (
                <div key={idx} className={`terminal-line terminal-${log.type}`}>
                  <span className="terminal-timestamp">[{log.timestamp}]</span> {log.message}
                </div>
              ))}
            </div>
          <div className="terminal-footer">
            <span className="terminal-footer-text">Press Enter to toggle vehicle offline/online mode</span>
            <button 
              className="mobile-toggle-button"
              onClick={handleToggleOffline}
              disabled={!isScriptRunning}
              title="Toggle offline/online mode"
            >
              {isOnline ? 'Toggle Offline' : 'Toggle Online'}
            </button>
          </div>
        </div>

        {/* Current Values */}
        <div className="grid-item current-values">
          <h2>Current Values{selectedVehicle !== 'all' && ` - VIN: ${selectedVehicle}`}</h2>
          {filteredData.length === 0 ? (
            <div className="waiting-message">
              <p>
                {selectedVehicle === 'all' 
                  ? 'No data yet - start the logger' 
                  : `No data for vehicle ${selectedVehicle}`}
              </p>
            </div>
          ) : (
            <div className="values-grid-compact">
              <div className="value-card">
                <span className="value-label">Speed</span>
                <span className="value-number">{filteredData[filteredData.length - 1]?.speed.toFixed(1)} mph</span>
              </div>
              <div className="value-card">
                <span className="value-label">Miles Traveled</span>
                <span className="value-number">
                  {(() => {
                    const last = filteredData[filteredData.length - 1];
                    const baseOdometer = initialOdometer ?? (filteredData.length > 0 ? filteredData[0].odometer : 0);
                    if (last?.odometer !== undefined) {
                      return (last.odometer - baseOdometer).toFixed(2) + ' mi';
                    }
                    return '0.00 mi';
                  })()}
                </span>
              </div>
              <div className="value-card">
                <span className="value-label">Power</span>
                <span className="value-number">{filteredData[filteredData.length - 1]?.power.toFixed(1)} kW</span>
              </div>
              <div className="value-card">
                <span className="value-label">Heading</span>
                <span className="value-number">
                  {(() => {
                    const heading = filteredData[filteredData.length - 1]?.heading;
                    if (heading !== undefined) {
                      return `${getCompassDirection(heading)} (${heading}°)`;
                    }
                    return 'N (0°)';
                  })()}
                </span>
              </div>
              <div className="value-card">
                <span className="value-label">Efficiency</span>
                <span className="value-number">
                  {analyticsData.whPerMile > 0 ? `${analyticsData.whPerMile} Wh/mi` : 'Calculating...'}
                </span>
              </div>
              <div className="value-card">
                <span className="value-label">Smoothness</span>
                <span className="value-number">
                  {filteredData.length > 2 ? `${analyticsData.smoothness}/100` : 'Calculating...'}
                </span>
              </div>
              <div className="value-card compression-stats">
                <span className="value-label">Bandwidth Saved</span>
                <span className="value-number compression-ratio">
                  {compressionStats.compression_ratio.toFixed(1)}%
                </span>
              </div>
              <div className="value-card compression-stats">
                <span className="value-label">Fields Skipped</span>
                <span className="value-number">
                  {compressionStats.skipped_readings} / {compressionStats.total_readings}
                </span>
              </div>
              <div className="value-card compression-stats">
                <span className="value-label">Packets Sent</span>
                <span className="value-number">
                  {Math.floor(compressionStats.total_readings / 4)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Help Modal */}
      {showHelp && (
        <div className="modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>📖 Dashboard Guide</h2>
              <button className="modal-close" onClick={() => setShowHelp(false)}>×</button>
            </div>
            <div className="modal-body">
              <section>
                <h3>What is this?</h3>
                <p>A fault-tolerant telemetry system that demonstrates <strong>store-and-forward</strong> architecture. When the vehicle loses network connectivity, data is buffered locally and automatically uploaded when connection is restored.</p>
                <p>The data shown is from a real Tesla Model 3 drive from Fremont to San Jose, California.</p>
              </section>

              <section>
                <h3>Architecture</h3>
                <ul>
                  <li><strong>Frontend:</strong> React dashboard deployed on Vercel</li>
                  <li><strong>Backend:</strong> Python FastAPI + C++ logger running on Google Cloud Run</li>
                  <li><strong>Communication:</strong> WebSocket for real-time data streaming</li>
                  <li><strong>Storage:</strong> SQLite for offline data buffering</li>
                </ul>
              </section>

              <section>
                <h3>How to use</h3>
                <ul>
                  <li><strong>▶ Play Button:</strong> Start the logger to begin replaying Tesla drive data</li>
                  <li><strong>■ Stop Button:</strong> Stop the logger and clear all data</li>
                  <li><strong>Press Enter:</strong> Toggle vehicle offline/online mode to simulate network interruptions</li>
                </ul>
              </section>

              <section>
                <h3>What happens offline?</h3>
                <p>When you press Enter to go offline:</p>
                <ul>
                  <li>The logger buffers data to a local SQLite database</li>
                  <li>You'll see <code>[BUFFERED]</code> messages in the terminal</li>
                  <li>Charts stop updating (no data sent to server)</li>
                  <li>Press Enter again to reconnect and flush all buffered records</li>
                  <li>Charts will update with all the buffered data at once</li>
                </ul>
              </section>

              <section>
                <h3>Metrics explained</h3>
                <ul>
                  <li><strong>Speed:</strong> Vehicle speed in mph</li>
                  <li><strong>Miles Traveled:</strong> Distance covered since logger started</li>
                  <li><strong>Power:</strong> Instantaneous power consumption in kW (negative = regenerative braking)</li>
                  <li><strong>Heading:</strong> Compass direction the vehicle is facing</li>
                  <li><strong>Efficiency (Wh/mi):</strong> Energy consumption per mile (lower is better). Calculated as total energy (Wh) ÷ distance traveled</li>
                  <li><strong>Smoothness (0-100):</strong> Driving smoothness score based on acceleration changes (jerk). Higher = smoother driving with less harsh acceleration/braking</li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* Compression Info Modal */}
      {showCompressionInfo && (
        <div className="modal-overlay" onClick={() => setShowCompressionInfo(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>📊 Smart Compression Engine</h2>
              <button className="modal-close" onClick={() => setShowCompressionInfo(false)}>×</button>
            </div>
            <div className="modal-body">
              <section>
                <h3>How It Works</h3>
                <p>The system uses <strong>predictive compression</strong> with exponential smoothing to reduce bandwidth by 60-90%.</p>
              </section>

              <section>
                <h3>Algorithm</h3>
                <pre style={{background: 'rgba(0,0,0,0.05)', padding: '0.5rem', borderRadius: '5px', fontSize: '0.9rem'}}>
predicted = 0.3 × actual + 0.7 × previous_predicted
                </pre>
                <p>Only transmits fields when <code>|actual - predicted| &gt; threshold</code></p>
              </section>

              <section>
                <h3>Compression Thresholds</h3>
                <ul>
                  <li><strong>Speed:</strong> ±2 mph</li>
                  <li><strong>Power:</strong> ±5 kW</li>
                  <li><strong>Battery:</strong> ±0.5%</li>
                  <li><strong>Heading:</strong> ±5°</li>
                </ul>
              </section>

              <section>
                <h3>Example</h3>
                <p><strong>Highway Cruise Control (65 mph):</strong></p>
                <ul>
                  <li>Speed prediction: 65.1 mph</li>
                  <li>Actual: 65.0 mph → difference 0.1 mph</li>
                  <li>0.1 &lt; 2 mph threshold → <strong>speed field omitted</strong></li>
                  <li>Result: ~30% packet size reduction</li>
                </ul>
              </section>

              <section>
                <h3>Safety Feature</h3>
                <p>Every 30 seconds, all fields are transmitted regardless of thresholds to prevent predictor drift and ensure long-term accuracy.</p>
              </section>

              <section>
                <h3>Metrics</h3>
                <ul>
                  <li><strong>Bandwidth Saved:</strong> Percentage of fields skipped vs total</li>
                  <li><strong>Fields Skipped:</strong> Count of omitted fields (higher = better compression)</li>
                  <li><strong>Packets Sent:</strong> Number of telemetry packets processed</li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;