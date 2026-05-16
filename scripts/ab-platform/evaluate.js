const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const baselinePath = process.argv[2];
const candidatePath = process.argv[3];
const apiUrl = process.argv[4];
const githubUrl = process.argv[5];
const baselineBranch = process.argv[6] || 'main';
const candidateBranch = process.argv[7] || 'candidate';

if (!baselinePath || !candidatePath) {
    console.error("Usage: node evaluate.js <baseline-results.json> <candidate-results.json> [apiUrl] [githubUrl] [baselineBranch] [candidateBranch]");
    process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(path.resolve(baselinePath), 'utf8'));
const candidate = JSON.parse(fs.readFileSync(path.resolve(candidatePath), 'utf8'));

// Extract metrics
const getMetrics = (res) => {
    const totalRequests = res.requests.total;
    const errors = res.errors + res.timeouts + res.non2xx;
    const successRate = totalRequests > 0 ? ((totalRequests - errors) / totalRequests) * 100 : 0;
    
    return {
        successRate: successRate,
        p99Latency: res.latency.p99,
        rps: res.requests.average,
        avgLatency: res.latency.average
    };
};

const baselineMetrics = getMetrics(baseline);
const candidateMetrics = getMetrics(candidate);

console.log(`\n================= PERFORMANCE A/B TEST RESULTS =================\n`);

console.log(`[Baseline - Branch A]`);
console.log(`Success Rate: ${baselineMetrics.successRate.toFixed(4)}%`);
console.log(`p99 Latency:  ${baselineMetrics.p99Latency} ms`);
console.log(`Avg Latency:  ${baselineMetrics.avgLatency} ms`);
console.log(`RPS:          ${baselineMetrics.rps}\n`);

console.log(`[Candidate - Branch B]`);
console.log(`Success Rate: ${candidateMetrics.successRate.toFixed(4)}%`);
console.log(`p99 Latency:  ${candidateMetrics.p99Latency} ms`);
console.log(`Avg Latency:  ${candidateMetrics.avgLatency} ms`);
console.log(`RPS:          ${candidateMetrics.rps}\n`);

console.log(`========================= EVALUATION =========================\n`);

let failed = false;

// 1. Reliability Gate (Hard Fail)
// The candidate branch must maintain a Success Rate of >= 99.9%.
if (candidateMetrics.successRate < 99.9) {
    console.error(`❌ Reliability Gate FAILED: Candidate Success Rate (${candidateMetrics.successRate.toFixed(4)}%) is below 99.9%.`);
    failed = true;
} else {
    console.log(`✅ Reliability Gate PASSED (Success Rate >= 99.9%)`);
}

// 2. Tolerance Gate (Degradation Limit)
// The candidate branch's p99 Latency cannot be more than 5% slower than the baseline branch.
const maxAllowedP99 = baselineMetrics.p99Latency * 1.05;
if (candidateMetrics.p99Latency > maxAllowedP99) {
    console.error(`❌ Tolerance Gate FAILED: Candidate p99 (${candidateMetrics.p99Latency}ms) is more than 5% slower than Baseline (${maxAllowedP99.toFixed(2)}ms).`);
    failed = true;
} else {
    console.log(`✅ Tolerance Gate PASSED (p99 is within 5% degradation limit)`);
}

// 3. Improvement Gate (Success Condition)
// To be declared a "Performance Win," candidate RPS >= 1.01 * baseline RPS.
const minTargetRPS = baselineMetrics.rps * 1.01;
if (candidateMetrics.rps >= minTargetRPS) {
    console.log(`🏆🏆 Improvement Gate PASSED: Candidate achieved Performance Win! RPS (${candidateMetrics.rps}) is >= 1% higher than Baseline (${minTargetRPS.toFixed(2)}).`);
} else {
    console.error(`❌ Improvement Gate FAILED: Candidate RPS (${candidateMetrics.rps}) did not achieve a 1% improvement over Baseline (${minTargetRPS.toFixed(2)}).`);
    failed = true;
}

console.log(`\n==============================================================\n`);

const payload = JSON.stringify({
    githubUrl: githubUrl || "Unknown",
    testData: {
        baselineBranch,
        candidateBranch,
        baselineMetrics: {
            requestsPerSecond: baselineMetrics.rps,
            latencyAverage: baselineMetrics.avgLatency,
            latency99th: baselineMetrics.p99Latency,
            successRate: baselineMetrics.successRate
        },
        candidateMetrics: {
            requestsPerSecond: candidateMetrics.rps,
            latencyAverage: candidateMetrics.avgLatency,
            latency99th: candidateMetrics.p99Latency,
            successRate: candidateMetrics.successRate
        },
        passed: !failed
    }
});

const sendResults = () => {
    return new Promise((resolve, reject) => {
        if (!apiUrl) {
            console.log("No API URL provided, skipping reporting results.");
            resolve();
            return;
        }

        const url = new URL(apiUrl);
                const options = {
                    hostname: url.hostname,
                    port: url.port,
                    path: url.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload)
                    }
                };

                // Attach API token header if present in environment
                const apiToken = process.env.SEEK_API_TOKEN || '';
                if (apiToken) {
                    options.headers['x-seek-api-token'] = apiToken;
                }

        const client = url.protocol === 'https:' ? https : http;
        const reqPost = client.request(options, (resPost) => {
            let data = '';
            resPost.on('data', (chunk) => { data += chunk; });
            resPost.on('end', () => {
                console.log(`Report sent, status code: ${resPost.statusCode}`);
                resolve(data);
            });
        });

        reqPost.on('error', (e) => {
            console.error(e);
            reject(e);
        });

        reqPost.write(payload);
        reqPost.end();
    });
};

sendResults().catch(err => console.error("Could not send results:", err)).finally(() => {
    if (failed) {
        console.error("⛔ OVERALL RESULT: REJECT CANDIDATE \n");
        process.exit(1);
    } else {
        console.log("🟢 OVERALL RESULT: ACCEPT CANDIDATE (PERFORMANCE WIN) \n");
        process.exit(0);
    }
});
