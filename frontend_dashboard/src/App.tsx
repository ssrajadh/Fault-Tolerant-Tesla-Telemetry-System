import React, { useEffect, useState, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './App.css';

interface TelemetryData {
  timestamp: number;
  speed: number;
  battery: number;
  power: number;
  gear: string;
  received_at: string;
}

interface WebSocketMessage {
  type: 'history' | 'telemetry';
  data: TelemetryData | TelemetryData[];
}

function App() {
  const [telemetryData, setTelemetryData] = useState<TelemetryData[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const maxDataPoints = 200;

  useEffect(() => {
    // Connect to WebSocket
    const ws = new WebSocket('ws://localhost:8000/ws');
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      const message: WebSocketMessage = JSON.parse(event.data);
      
      if (message.type === 'history') {
        // Initial data load
        const historyData = message.data as TelemetryData[];
        setTelemetryData(historyData.slice(-maxDataPoints));
        setLastUpdate(new Date());
      } else if (message.type === 'telemetry') {
        // Real-time update
        const newData = message.data as TelemetryData;
        setTelemetryData(prev => {
          const updated = [...prev, newData];
          return updated.slice(-maxDataPoints); // Keep last N points
        });
        setLastUpdate(new Date());
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
    };

    // Cleanup on unmount
    return () => {
      ws.close();
    };
  }, []);

  // Format timestamp for display
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  // Transform data for charts
  const chartData = telemetryData.map(d => ({
    time: formatTime(d.timestamp),
    timestamp: d.timestamp,
    speed: d.speed,
    battery: d.battery,
    power: d.power,
  }));

  return (
    <div className="App">
      <header className="App-header">
        <h1>🚗 Tesla Telemetry Dashboard</h1>
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

      <div className="dashboard-container">
        {telemetryData.length === 0 ? (
          <div className="no-data">
            <h2>Waiting for telemetry data...</h2>
            <p>Make sure the Python server and C++ logger are running.</p>
          </div>
        ) : (
          <>
            {/* Speed Chart */}
            <div className="chart-container">
              <h2>Vehicle Speed</h2>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="time" 
                    tick={{ fontSize: 12 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis 
                    label={{ value: 'Speed (mph)', angle: -90, position: 'insideLeft' }}
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

            {/* Battery Chart */}
            <div className="chart-container">
              <h2>Battery Level</h2>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="time" 
                    tick={{ fontSize: 12 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis 
                    domain={[0, 100]}
                    label={{ value: 'Battery (%)', angle: -90, position: 'insideLeft' }}
                  />
                  <Tooltip />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="battery" 
                    stroke="#82ca9d" 
                    strokeWidth={2}
                    dot={false}
                    name="Battery (%)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Power Chart */}
            <div className="chart-container">
              <h2>Power Usage</h2>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="time" 
                    tick={{ fontSize: 12 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis 
                    label={{ value: 'Power (kW)', angle: -90, position: 'insideLeft' }}
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

            {/* Current Values */}
            <div className="current-values">
              <h2>Current Values</h2>
              <div className="values-grid">
                <div className="value-card">
                  <span className="value-label">Speed</span>
                  <span className="value-number">{telemetryData[telemetryData.length - 1]?.speed.toFixed(1)} mph</span>
                </div>
                <div className="value-card">
                  <span className="value-label">Battery</span>
                  <span className="value-number">{telemetryData[telemetryData.length - 1]?.battery}%</span>
                </div>
                <div className="value-card">
                  <span className="value-label">Power</span>
                  <span className="value-number">{telemetryData[telemetryData.length - 1]?.power.toFixed(1)} kW</span>
                </div>
                <div className="value-card">
                  <span className="value-label">Gear</span>
                  <span className="value-number">{telemetryData[telemetryData.length - 1]?.gear}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <footer className="App-footer">
        <p>Fault-Tolerant Tesla Telemetry System | Store-and-Forward Edge Computing</p>
      </footer>
    </div>
  );
}

export default App;
