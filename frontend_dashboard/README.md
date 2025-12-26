# React Dashboard

Real-time web dashboard built with React 18 and TypeScript for visualizing Tesla vehicle telemetry data. Features interactive charts, live WebSocket streaming, and logger control interface.

## Overview

This frontend application provides:
- **Real-time telemetry visualization** via WebSocket streaming
- **Interactive charts** using Recharts for speed, battery, power, and efficiency
- **Logger control** (start/stop) integrated in the UI
- **Multi-vehicle support** with vehicle identification
- **Compression statistics** display
- **Responsive design** for desktop and mobile devices

## Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type-safe JavaScript
- **Recharts** - Charting library
- **WebSocket API** - Real-time data streaming
- **CSS3** - Styling with modern features (Grid, Flexbox)

## Features

### Real-Time Charts
- **Speed Chart**: Vehicle speed over time
- **Battery Chart**: Battery level percentage
- **Power Chart**: Power consumption in kW
- **Efficiency Chart**: Calculated efficiency (speed/power ratio)
- **Distance Chart**: Odometer progression

### Interactive Controls
- **Play/Stop Button**: Start and stop the telemetry logger
- **Enter Key**: Quick disconnect from terminal view
- **Responsive Layout**: Adapts to different screen sizes

### Data Display
- Latest telemetry values in real-time
- Compression statistics (transmitted vs skipped fields)
- Logger status messages
- Vehicle VIN identification

## Project Structure

```
frontend_dashboard/
├── public/              # Static assets
│   ├── index.html      # HTML template
│   └── ...
├── src/
│   ├── App.tsx         # Main application component
│   ├── App.css         # Application styles
│   ├── index.tsx       # React entry point
│   ├── index.css       # Global styles
│   └── ...
├── package.json        # Dependencies and scripts
└── tsconfig.json       # TypeScript configuration
```

## Installation

### Prerequisites
- Node.js 16+ and npm

### Setup
```bash
cd frontend_dashboard
npm install
```

## Development

### Start Development Server
```bash
npm start
```

Runs on `http://localhost:3000` by default.

The app will automatically reload when you make changes.

### Build for Production
```bash
npm run build
```

Creates an optimized production build in the `build/` directory.

### Test
```bash
npm test
```

## Configuration

### Backend URL
Set the backend URL via environment variable:

```bash
REACT_APP_BACKEND_URL=http://localhost:8001
```

For production, set to your Cloud Run URL:
```bash
REACT_APP_BACKEND_URL=https://your-service.run.app
```

The WebSocket URL is automatically derived (ws:// or wss://).

## WebSocket Protocol

### Connection
Connects to `ws://<backend_url>/ws` on component mount.

### Message Types

#### From Server

**History (Initial Load)**
```json
{
  "type": "history",
  "data": [
    {
      "timestamp": 1234567890,
      "speed": 65.0,
      "battery": 82,
      "power": 12.5,
      "heading": 45,
      "vehicle_vin": "5YJ3E1EA1KF000001"
    }
  ]
}
```

**Telemetry (Real-Time Update)**
```json
{
  "type": "telemetry",
  "data": {
    "timestamp": 1234567890,
    "speed": 65.0,
    "battery": 82,
    "power": 12.5,
    "heading": 45,
    "vehicle_vin": "5YJ3E1EA1KF000001"
  }
}
```

**Log Messages**
```json
{
  "type": "log",
  "message": "Logger started successfully",
  "log_type": "success"
}
```

**Compression Stats**
```json
{
  "type": "compression_stats",
  "compression_stats": {
    "total_readings": 1000,
    "transmitted_readings": 350,
    "skipped_readings": 650,
    "compression_ratio": 0.65
  }
}
```

#### To Server

**Start Logger**
```json
{
  "type": "start_logger"
}
```

**Stop Logger**
```json
{
  "type": "stop_logger"
}
```

## Component Architecture

### App.tsx
Main component that manages:
- WebSocket connection lifecycle
- Telemetry data state
- Chart rendering
- Logger control UI
- Compression statistics display

### State Management
- Uses React hooks (`useState`, `useEffect`, `useRef`)
- Local state for telemetry data arrays
- WebSocket connection in `useEffect`
- Chart data computed with `useMemo` for performance

## Styling

### App.css
Modern CSS with:
- CSS Grid for responsive layout
- Flexbox for component alignment
- CSS variables for theming
- Smooth transitions and animations
- Mobile-responsive breakpoints

### Color Scheme
- Primary: Blue (#007bff)
- Success: Green (#28a745)
- Error: Red (#dc3545)
- Background: Light gray (#f5f5f5)

## Performance Optimizations

1. **Memoized Chart Data**: Computed with `useMemo` to prevent unnecessary recalculations
2. **Data Limits**: Charts display last 100 points to prevent memory issues
3. **WebSocket Throttling**: Server-side throttling prevents overwhelming the UI
4. **Efficient Re-renders**: React only re-renders when state changes

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Deployment

### Vercel
The project includes `vercel.json` configuration for Vercel deployment.

```bash
npm install -g vercel
vercel
```

### Static Hosting
Build and deploy the `build/` directory to any static hosting service:
- Netlify
- GitHub Pages
- AWS S3 + CloudFront
- Google Cloud Storage

### Environment Variables
Set `REACT_APP_BACKEND_URL` in your hosting platform's environment variables.

## Troubleshooting

### WebSocket Connection Fails
1. Check backend URL is correct
2. Ensure backend server is running
3. Check CORS settings on backend
4. Verify WebSocket endpoint is accessible

### Charts Not Updating
1. Check WebSocket is connected (check browser console)
2. Verify data is being received (check Network tab)
3. Check React DevTools for state updates

### Build Errors
1. Clear `node_modules` and reinstall: `rm -rf node_modules && npm install`
2. Clear cache: `npm start -- --reset-cache`
3. Check Node.js version matches requirements

## Future Enhancements

- [ ] Multiple vehicle selection/dashboard
- [ ] Date range filtering for historical data
- [ ] Export data to CSV/JSON
- [ ] Dark mode theme
- [ ] Custom chart configurations
- [ ] Real-time map view with GPS coordinates
- [ ] Alert system for battery low, speed limits, etc.
- [ ] User authentication and multi-user support
- [ ] PWA (Progressive Web App) support
- [ ] Offline data caching

