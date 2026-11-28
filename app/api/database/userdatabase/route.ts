import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/db_connect';
import TeamUser from '@/lib/models/TeamUsers';
import { NextRequest, NextResponse } from 'next/server';
import { parseJsonBody } from '@/lib/auth/session';
import { objectIdSchema, teamUserSchema } from '@/lib/validation/schemas';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const roomId = req.nextUrl.searchParams.get('roomId')?.trim() || 'default';

    await dbConnect();
    const users = await TeamUser.find({
      ownerEmail: session.user.email,
      roomId,
    })
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json(
      {
        users: users.map((u) => ({
          _id: String(u._id),
          userId: u.userId,
          role: u.role,
          roomId: u.roomId,
        })),
      },
      { status: 200 }
    );
  } catch (e) {
    console.error('GET /api/database/userdatabase error:', e);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const parsedBody = await parseJsonBody(req);
    if (!parsedBody.ok) {
      return NextResponse.json({ message: 'Invalid JSON request body' }, { status: 400 });
    }

    const validation = teamUserSchema.safeParse(parsedBody.data);
    if (!validation.success) {
      return NextResponse.json(
        { message: 'Validation failed', errors: validation.error.issues },
        { status: 400 }
      );
    }

    const { userId, role, roomId = 'default' } = validation.data;

    await dbConnect();
    const savedUser = await TeamUser.findOneAndUpdate(
      { ownerEmail: session.user.email, roomId, userId },
      { $set: { role }, $setOnInsert: { ownerEmail: session.user.email, roomId, userId } },
      { upsert: true, new: true }
    );

    return NextResponse.json(
      {
        message: 'User saved successfully',
        user: {
          _id: String(savedUser._id),
          userId: savedUser.userId,
          role: savedUser.role,
          roomId: savedUser.roomId,
        },
      },
      { status: 201 }
    );
  } catch (e) {
    console.error('POST /api/database/userdatabase error:', e);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const id = req.nextUrl.searchParams.get('id');
    const idCheck = objectIdSchema.safeParse(id);
    if (!idCheck.success) {
      return NextResponse.json({ message: 'Invalid member ID' }, { status: 400 });
    }

    await dbConnect();
    const deleted = await TeamUser.findOneAndDelete({
      _id: idCheck.data,
      ownerEmail: session.user.email,
    });

    if (!deleted) {
      return NextResponse.json({ message: 'Team member not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Member removed' }, { status: 200 });
  } catch (e) {
    console.error('DELETE /api/database/userdatabase error:', e);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
