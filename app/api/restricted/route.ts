import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]/route';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (session) {
      return NextResponse.json({
        content: 'This is protected content. You can access this content because you are signed in.',
      });
    }

    return NextResponse.json(
      { error: 'You must be signed in to view the protected content on this page.' },
      { status: 401 }
    );
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
