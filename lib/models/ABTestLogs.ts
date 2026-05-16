import mongoose from 'mongoose';

const ABTestLogsSchema = new mongoose.Schema({
    githubUrl: { type: String, required: true },
    abTests: [{
      testedAt: { type: Date, default: Date.now },
      baselineBranch: { type: String },
      candidateBranch: { type: String },
      baselineMetrics: {
        requestsPerSecond: { type: Number },
        latencyAverage: { type: Number },
        latency99th: { type: Number },
        successRate: { type: Number }
      },
      candidateMetrics: {
        requestsPerSecond: { type: Number },
        latencyAverage: { type: Number },
        latency99th: { type: Number },
        successRate: { type: Number }
      },
      passed: { type: Boolean }
    }]
});

const ABTestLogs = mongoose.models.ABTestLogs || mongoose.model('ABTestLogs', ABTestLogsSchema);

export default ABTestLogs;