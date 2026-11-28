import mongoose from 'mongoose';

const MonitorMetricSchema = new mongoose.Schema(
  {
    monitorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WebServer',
      required: true,
      index: true,
    },
    url: { type: String, required: true },
    ownerEmail: { type: String, required: true, index: true },
    status: { type: String, enum: ['up', 'down'], required: true },
    latencyMs: { type: Number, required: true, default: 0 },
    ttfbMs: { type: Number, default: 0 },
    connectMs: { type: Number, default: 0 },
    tlsMs: { type: Number, default: 0 },
    resolveMs: { type: Number, default: 0 },
    transferMs: { type: Number, default: 0 },
    httpStatusCode: { type: Number, default: 0 },
    httpVersion: { type: String, default: '' },
    compressed: { type: Boolean, default: false },
    cacheStatus: { type: String, default: 'NONE' },
    cdnProvider: { type: String, default: '' },
    mode: {
      type: String,
      enum: ['baseline', 'pre-event', 'surge'],
      default: 'baseline',
    },
    source: {
      type: String,
      enum: ['blackbox', 'prometheus', 'direct'],
      default: 'direct',
    },
    reason: { type: String, default: '' },
    timestamp: {
      type: Date,
      default: Date.now,
      expires: 60 * 60 * 24 * 60, // Retain 60 days of telemetry
    },
  },
  {
    versionKey: false,
  }
);

MonitorMetricSchema.index({ monitorId: 1, timestamp: -1 });

const MonitorMetric =
  mongoose.models.MonitorMetric || mongoose.model('MonitorMetric', MonitorMetricSchema);

export default MonitorMetric;
