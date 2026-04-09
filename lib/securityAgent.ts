import { promises as fs } from 'fs';
import path from 'path';

const MALICIOUS_EXTENSIONS = ['.exe', '.sh', '.bat', '.apk', '.cmd', '.ps1', '.vbs', '.msi', '.bin', '.scr'];
const MALICIOUS_KEYWORDS = ['trojan', 'malware', 'exploit', 'payload', 'wget', 'curl'];

export function isMaliciousUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname.toLowerCase();
    
    // Check for malicious file extensions
    for (const ext of MALICIOUS_EXTENSIONS) {
      if (pathname.endsWith(ext)) {
        return true;
      }
    }

    // Check for malicious command injection patterns or keywords in the url
    const lowerUrl = url.toLowerCase();
    for (const keyword of MALICIOUS_KEYWORDS) {
      if (lowerUrl.includes(keyword)) {
        return true;
      }
    }

    return false;
  } catch (error) {
    // Treat invalid parser exceptions as dangerous inputs
    return true;
  }
}

export async function logMaliciousAttempt(ip: string | null, attemptedUrl: string, userEmail?: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] IP: ${ip || 'UNKNOWN'} | User: ${userEmail || 'UNAUTHENTICATED'} | Blocked URL: ${attemptedUrl}\n`;
  
  // Save to secure local file
  const logFilePath = path.join(process.cwd(), 'admin_security_logs.txt');
  
  try {
    await fs.appendFile(logFilePath, logEntry, 'utf8');
    console.warn(`[SECURITY AGENT] Malicious request blocked! Logged to ${logFilePath}`);
  } catch (err) {
    console.error('[SECURITY AGENT] Failed to write to security log file', err);
  }
}
