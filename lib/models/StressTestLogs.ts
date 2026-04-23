import mongoose from 'mongoose';

const StressTestLogsSchema = new mongoose.Schema({
    githubUrl: { type: String, required: true },
    stressTests: [{
  testedAt: { type: Date, default: Date.now },
  requestsPerSecond: { type: Number },
  latencyAverage: { type: Number },
  latency99th: { type: Number },
  totalRequests: { type: Number },
  successRate: { type: Number }
}]
});

const StressTestLogs = mongoose.models.StressTestLogs || mongoose.model('StressTestLogs', StressTestLogsSchema);

export default StressTestLogs;