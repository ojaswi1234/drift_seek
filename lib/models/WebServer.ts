import mongoose from 'mongoose';

const WebServerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
    ownerEmail: { type: String, required: true, index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

WebServerSchema.index({ ownerEmail: 1, url: 1 }, { unique: true });

const WebServer = mongoose.models.WebServer || mongoose.model('WebServer', WebServerSchema);

export default WebServer;
