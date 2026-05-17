import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db_connect';
import ABTestLogs from '@/lib/models/ABTestLogs';

export async function GET() {
  try {
    await dbConnect();
    const logs = await ABTestLogs.find({}, { abTests: { $slice: -10 } }).sort({ 'abTests.testedAt': -1 });
    return NextResponse.json({ success: true, data: logs });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    // Simple token-based auth to prevent unwanted posts from public callers
    const incomingToken = (req.headers.get('x-seek-api-token') || '').trim();
    const expectedToken = process.env.SEEK_API_TOKEN || '';

    if (expectedToken && incomingToken !== expectedToken) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();
    const body = await req.json();
    const { githubUrl, testData } = body;

    if (!githubUrl || !testData) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    let logEntity = await ABTestLogs.findOne({ githubUrl });
    if (!logEntity) {
      logEntity = new ABTestLogs({
        githubUrl,
        abTests: [testData]
      });
    } else {
      logEntity.abTests.push(testData);
    }

    await logEntity.save();
    return NextResponse.json({ success: true, data: logEntity }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
