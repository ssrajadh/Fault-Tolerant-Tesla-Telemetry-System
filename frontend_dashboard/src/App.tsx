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
}

interface LogMessage {
  timestamp: string;
  message: string;
  type?: 'info' | 'success' | 'error' | 'warning';
}

interface WebSocketMessage {
  type: 'history' | 'telemetry' | 'log';
  data?: TelemetryData | TelemetryData[];
  message?: string;
  log_type?: 'info' | 'success' | 'error' | 'warning';
}

function App() {
  // Backend URL from environment variable (localhost for dev, Cloud Run for production)
  const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
  const WS_URL = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');

  const [telemetryData, setTelemetryData] = useState<TelemetryData[]>([]);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isScriptRunning, setIsScriptRunning] = useState(false);
  const [initialOdometer, setInitialOdometer] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);
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
        .then(res => res.json())
        .then(data => {
          if (data.status === 'success') {
            addLog('Toggled vehicle offline/online mode', 'info');
          } else {
            addLog('Failed to toggle offline mode', 'error');
          }
        })
        .catch(() => {
          addLog('Failed to toggle offline mode', 'error');
        });
    }
  };

  const handlePlayScript = async () => {
    if (isScriptRunning) {
      // Stop script and clear data
      try {
        await fetch(`${BACKEND_URL}/stop_script`, { method: 'POST' });
        await fetch(`${BACKEND_URL}/clear_data`, { method: 'POST' });
        setIsScriptRunning(false);
        setTelemetryData([]);
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

  // Transform data for charts
  const chartData = useMemo(() => {
    const baseOdometer = initialOdometer ?? (telemetryData.length > 0 ? telemetryData[0].odometer : 0);
    return telemetryData.map((d) => {
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
          <button className="help-button" onClick={() => setShowHelp(true)} title="Help">
            ?
          </button>
        </div>
        <div className="status-bar">
          <div className="status-indicator">
            <span className={`status-dot ${isConnected ? 'online' : 'offline'}`}></span>
            <span className="status-text">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <div className="data-info">
            <span>Data Points: {telemetryData.length}</span>
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
            Press Enter to toggle vehicle offline/online mode
          </div>
        </div>

        {/* Current Values */}
        <div className="grid-item current-values">
          <h2>Current Values</h2>
          {telemetryData.length === 0 ? (
            <div className="waiting-message">
              <p>No data yet - start the logger</p>
            </div>
          ) : (
            <div className="values-grid-compact">
              <div className="value-card">
                <span className="value-label">Speed</span>
                <span className="value-number">{telemetryData[telemetryData.length - 1]?.speed.toFixed(1)} mph</span>
              </div>
              <div className="value-card">
                <span className="value-label">Miles Traveled</span>
                <span className="value-number">
                  {(() => {
                    const last = telemetryData[telemetryData.length - 1];
                    const baseOdometer = initialOdometer ?? (telemetryData.length > 0 ? telemetryData[0].odometer : 0);
                    if (last?.odometer !== undefined) {
                      return (last.odometer - baseOdometer).toFixed(2) + ' mi';
                    }
                    return '0.00 mi';
                  })()}
                </span>
              </div>
              <div className="value-card">
                <span className="value-label">Power</span>
                <span className="value-number">{telemetryData[telemetryData.length - 1]?.power.toFixed(1)} kW</span>
              </div>
              <div className="value-card">
                <span className="value-label">Heading</span>
                <span className="value-number">
                  {(() => {
                    const heading = telemetryData[telemetryData.length - 1]?.heading;
                    if (heading !== undefined) {
                      return `${getCompassDirection(heading)} (${heading}°)`;
                    }
                    return 'N (0°)';
                  })()}
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
                  <li><strong>Power:</strong> Power consumption in kW (positive = consuming, negative = regenerating)</li>
                  <li><strong>Heading:</strong> Compass direction the vehicle is traveling</li>
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