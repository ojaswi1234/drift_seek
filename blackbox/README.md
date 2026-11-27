# DriftSeeker Blackbox Monitoring

This directory contains the Blackbox Exporter monitoring stack for DriftSeeker, designed to work with **Grafana Cloud (Prometheus)** for alerting and **MongoDB** for persistent metric storage.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Blackbox       │────▶│  Metrics         │────▶│  MongoDB        │
│  Exporter       │     │  Collector       │     │  (Persistent)   │
│  (Stateless)    │     │  (Stateful)      │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │                        │
        │                        ▼                        │
        │               ┌──────────────────┐             │
        │               │  Grafana Cloud   │             │
        │               │  (Prometheus)    │             │
        │               │  - Alerting      │             │
        │               │  - Dashboards    │             │
        │               └──────────────────┘             │
        │                                                │
        └────────────────────────────────────────────────┘
                         Probes Targets
```

## Components

### 1. Blackbox Exporter (`blackbox/`)
- **Stateless** prober that checks endpoints
- Supports HTTP, HTTPS, TCP, gRPC, DNS, ICMP probes
- Zero disk storage - perfect for ephemeral environments like Render
- Configuration: `blackbox.yml`

### 2. Metrics Collector (`blackbox/metrics-collector/`)
- **Stateful** service that scrapes Blackbox Exporter
- Stores probe results in MongoDB for historical analysis
- Provides REST API for querying metrics
- Exposes `/metrics` endpoint for Grafana Cloud Prometheus scraping

### 3. Grafana Dashboard (`grafana-dashboard.json`)
- Pre-configured dashboard for visualizing probe results
- Shows service status, probe duration, success rates, HTTP status codes

## Quick Start (Local Development)

```bash
# From the blackbox directory
cd blackbox

# Start the monitoring stack
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f

# Access endpoints:
# - Blackbox Exporter: http://localhost:9115
# - Metrics Collector API: http://localhost:9116
# - MongoDB: mongodb://localhost:27017
```

## Deploy to Render

The `render.yaml` in the repository root includes Blackbox Exporter and Metrics Collector services.

```bash
# Deploy using Render CLI or connect your GitHub repo to Render
# The render.yaml will create:
# 1. driftseeker-blackbox (Blackbox Exporter)
# 2. driftseeker-metrics-collector (Metrics Collector)
# 3. MongoDB and Redis databases
```

### Required Environment Variables (Set in Render Dashboard)

For `driftseeker-metrics-collector`:
- `MONGODB_URI` - MongoDB connection string (from Render database)
- `BLACKBOX_URL` - URL of the Blackbox Exporter service

## Probe Targets Configuration

Edit `blackbox/blackbox.yml` to configure probe modules, then update the `TARGETS` array in `blackbox/metrics-collector/index.js` or set via environment variables:

```javascript
TARGETS: [
  { name: 'app', url: 'https://your-app.onrender.com', module: 'http_2xx' },
  { name: 'api', url: 'https://your-api.onrender.com/health', module: 'http_2xx' },
  { name: 'grpc', url: 'your-grpc-service:50051', module: 'grpc_health' },
  { name: 'tcp-service', url: 'your-tcp-service:1234', module: 'tcp' },
]
```

## Grafana Cloud Setup

1. **Create a Grafana Cloud account** (free tier available)
2. **Add Prometheus data source** pointing to your Metrics Collector `/metrics` endpoint
3. **Import the dashboard**: `blackbox/grafana-dashboard.json`
4. **Configure alerts** based on `blackbox_probe_success` metric

### Example Alert Rules

```yaml
groups:
  - name: driftseeker-blackbox
    rules:
      - alert: ServiceDown
        expr: blackbox_probe_success{job="blackbox"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "{{ $labels.target }} is down"
          
      - alert: HighLatency
        expr: blackbox_probe_duration_seconds{job="blackbox"} > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "{{ $labels.target }} high latency: {{ $value }}s"
```

## MongoDB Schema

Probe results are stored in the `blackbox_probes` collection:

```javascript
{
  _id: ObjectId,
  target: "app",
  url: "https://app.onrender.com",
  module: "http_2xx",
  timestamp: ISODate("2024-01-15T10:30:00Z"),
  success: true,
  duration_seconds: 0.245,
  http_status_code: 200,
  metrics: {
    probe_success: 1,
    probe_duration_seconds: 0.245,
    probe_http_status_code: 200,
    probe_http_version: 2,
    probe_http_content_length: 1234
  },
  error: null
}
```

## API Endpoints (Metrics Collector)

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /api/metrics/latest?limit=100&target=app` | Latest probe results |
| `GET /api/metrics/summary?hours=24` | Aggregated summary per target |
| `GET /api/metrics/history?target=app&hours=24` | Historical data for a target |
| `GET /metrics` | Prometheus format metrics (for Grafana Cloud) |

## Render Free Tier Considerations

- **Blackbox Exporter**: Runs as a Web Service (exposes port 9115)
- **Metrics Collector**: Runs as a Web Service (exposes port 9116)
- **MongoDB**: Use Render's managed MongoDB (free tier: 512MB)
- **Ephemeral disk**: Blackbox Exporter is stateless - no data loss on restart
- **Metrics persistence**: Stored in MongoDB, survives restarts

## Troubleshooting

### Blackbox Exporter not reachable
```bash
# Check if it's running
curl http://localhost:9115/health

# Check probe endpoint
curl "http://localhost:9115/probe?target=google.com&module=http_2xx"
```

### Metrics not appearing in Grafana
1. Verify `/metrics` endpoint returns data: `curl http://localhost:9116/metrics`
2. Check Prometheus scrape config in Grafana Cloud
3. Ensure network connectivity between Grafana Cloud and your Render services

### MongoDB connection issues
- Verify `MONGODB_URI` is correct
- Check IP allowlist in Render MongoDB settings
- Ensure metrics-collector service can reach MongoDB

## License

Part of DriftSeeker project - MIT License