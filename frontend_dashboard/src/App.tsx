import React, { useEffect, useState, useRef } from 'react';
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
  const [telemetryData, setTelemetryData] = useState<TelemetryData[]>([]);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isScriptRunning, setIsScriptRunning] = useState(false);
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

    const ws = new WebSocket('ws://localhost:8000/ws');
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
        // Initial data load
        const historyData = message.data as TelemetryData[];
        setTelemetryData(historyData.slice(-maxDataPoints));
        setLastUpdate(new Date());
        addLog(`Loaded ${historyData.length} historical records`, 'info');
      } else if (message.type === 'telemetry') {
        // Real-time update
        const newData = message.data as TelemetryData;
        setTelemetryData(prev => {
          const updated = [...prev, newData];
          return updated.slice(-maxDataPoints);
        });
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
      if (isConnected && wsRef.current) {
        // Go offline
        addLog('Going offline...', 'warning');
        wsRef.current.close();
      } else {
        // Reconnect
        addLog('Reconnecting...', 'info');
        connectWebSocket();
      }
    }
  };

  const handlePlayScript = async () => {
    if (isScriptRunning) {
      // Stop script
      try {
        await fetch('http://localhost:8000/stop_script', { method: 'POST' });
        setIsScriptRunning(false);
        addLog('Stopped logger script', 'warning');
      } catch (error) {
        addLog('Failed to stop script', 'error');
      }
    } else {
      // Start script
      try {
        const response = await fetch('http://localhost:8000/start_script', { method: 'POST' });
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
      const response = await fetch('http://localhost:8000/clear_data', { method: 'POST' });
      if (response.ok) {
        setTelemetryData([]);
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
    fetch('http://localhost:8000/status')
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

  // Transform data for charts
  const chartData = telemetryData.map((d, idx) => {
    const odometerDelta = idx > 0 ? d.odometer - telemetryData[0].odometer : 0;
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

  return (
    <div className="App">
      <header className="App-header">
        <h1>Tesla Model 3 Telemetry Dashboard</h1>
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
          <button 
            className="clear-data-button" 
            onClick={handleClearData}
            title="Clear all telemetry data"
          >
            🗑️ Clear Data
          </button>
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
            Press Enter to {isConnected ? 'go offline' : 'reconnect'}
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
                    const first = telemetryData[0];
                    if (last?.odometer !== undefined && first?.odometer !== undefined) {
                      return (last.odometer - first.odometer).toFixed(2) + ' mi';
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
                <span className="value-number">{telemetryData[telemetryData.length - 1]?.heading ?? 0}°</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;