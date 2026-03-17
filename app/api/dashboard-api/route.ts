import { NextResponse } from 'next/server';

// GET request handler
export async function GET() {
  return NextResponse.json({ message: "Hello from backend!" });
}

// POST request handler
export async function POST(req: Request) {
  const body = await req.json();
  return NextResponse.json({ received: body });
}
