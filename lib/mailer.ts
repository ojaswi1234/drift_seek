interface AlertPayload {
  url: string;
  reason: string;
  ownerEmail: string;
  title?: string;
  status?: 'up' | 'down' | 'info';
  latencyMs?: number;
  /** Per-monitor Telegram chat ID. Falls back to TELEGRAM_CHAT_ID env if omitted or empty. */
  chatId?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function sendTelegramAlert({
  url,
  reason,
  ownerEmail,
  title,
  status = 'down',
  latencyMs,
  chatId: perMonitorChatId,
}: AlertPayload): Promise<{ success: boolean; skipped?: boolean }> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = (perMonitorChatId || '').trim() || (process.env.TELEGRAM_CHAT_ID || '').trim();

  if (!botToken || !chatId) {
    console.warn('Missing Telegram credentials — set TELEGRAM_CHAT_ID globally or per-monitor in Surge Config.');
    return { success: false, skipped: true };
  }

  const headerText =
    title ||
    (status === 'up'
      ? '✅ <b>MONITOR CHECK: Server Online</b>'
      : status === 'info'
        ? 'ℹ️ <b>DRIFTSEEKER NOTICE</b>'
        : '🚨 <b>DRIFT DETECTED: Server Offline</b> 🚨');

  const lines = [
    headerText,
    '',
    `<b>Target URL:</b> ${escapeHtml(url)}`,
    `<b>Status:</b> ${escapeHtml(status.toUpperCase())}`,
    ...(typeof latencyMs === 'number' ? [`<b>Latency:</b> ${latencyMs}ms`] : []),
    `<b>Details:</b> ${escapeHtml(reason || 'OK')}`,
    `<b>Monitor Owner:</b> ${escapeHtml(ownerEmail)}`,
    `<b>Time:</b> ${new Date().toISOString()}`,
  ];

  const message = lines.join('\n');
  const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });

    if (!response.ok) {
      throw new Error(`Telegram API responded with status: ${response.status}`);
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to send Telegram alert:', error);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
