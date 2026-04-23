import mongoose from 'mongoose';

const StressTestLogsSchema = new mongoose.Schema({
    stressTests: [{
  testedAt: { type: Date, default: Date.now },
  requestsPerSecond: { type: Number },
  latencyAverage: { type: Number },
  latency95th: { type: Number },
  successRate: { type: Number }
}]
});

const StressTestLogs = mongoose.models.StressTestLogs || mongoose.model('StressTestLogs', StressTestLogsSchema);

export default StressTestLogs;