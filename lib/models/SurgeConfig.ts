import mongoose from 'mongoose';

const EventSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true, maxlength: 100 },
  date: { type: Date, required: true },
  type: { 
    type: String, 
    enum: ['festival', 'launch', 'holiday', 'custom'],
    required: true 
  },
  description: { type: String },
  enabled: { type: Boolean, default: true },
}, { _id: false });

const ReadinessChecksSchema = new mongoose.Schema({
  cdn: { type: Boolean, default: true },
  compression: { type: Boolean, default: true },
  protocol: { type: Boolean, default: true },
  cacheHeaders: { type: Boolean, default: true },
  sslExpiry: { type: Boolean, default: true },
}, { _id: false });

const SurgeConfigSchema = new mongoose.Schema({
  monitorId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'WebServer', 
    required: true,
    unique: true 
  },
  ownerEmail: { type: String, required: true, index: true },
  events: [EventSchema],
  baselineInterval: { type: Number, default: 5, min: 1, max: 60 }, // minutes
  preEventInterval: { type: Number, default: 1, min: 1, max: 10 }, // minutes
  surgeInterval: { type: Number, default: 15, min: 5, max: 60 }, // seconds
  preEventWindowHours: { type: Number, default: 24, min: 1, max: 72 },
  surgeWindowHours: { type: Number, default: 24, min: 1, max: 72 },
  telegramEnabled: { type: Boolean, default: true },
  actionOnlyOnScheduledDays: { type: Boolean, default: false },
  activeDaysOfWeek: {
    type: [Number],
    default: [],
    validate: {
      validator: (days: number[]) =>
        Array.isArray(days) && days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
      message: 'activeDaysOfWeek must contain integers between 0 (Sun) and 6 (Sat)',
    },
  },
  autoReadinessAlert: { type: Boolean, default: true },
  useBlackboxProbe: { type: Boolean, default: true },
  telegramChatId: { type: String, default: '' }, // per-user Telegram chat ID; falls back to TELEGRAM_CHAT_ID env if empty
  readinessChecks: { type: ReadinessChecksSchema, default: () => ({}) },
  lastReadinessReport: {
    score: Number,
    report: mongoose.Schema.Types.Mixed,
    generatedAt: Date,
  },
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index for finding configs with upcoming events
SurgeConfigSchema.index({ 'events.date': 1, 'events.enabled': 1 });

const SurgeConfig = mongoose.models.SurgeConfig || mongoose.model('SurgeConfig', SurgeConfigSchema);

export default SurgeConfig;