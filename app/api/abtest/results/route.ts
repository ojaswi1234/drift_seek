import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db_connect';
import ABTestLogs from '@/lib/models/ABTestLogs';

export async function GET() {
  try {
    await dbConnect();
    const logs = await ABTestLogs.find({}).sort({ 'abTests.testedAt': -1 });
    return NextResponse.json({ success: true, data: logs });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
