import mongoose from 'mongoose';

const WebServerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  url: { type: String, required: true , unique: true},
  // status, reason, latency will be moved to Redis later
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

const WebServer = mongoose.models.WebServer || mongoose.model('WebServer', WebServerSchema);

export default WebServer;