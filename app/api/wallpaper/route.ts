import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/db_connect';
import Wallpaper from '@/lib/models/Wallpaper';
import { parseJsonBody } from '@/lib/auth/session';
import { objectIdSchema } from '@/lib/validation/schemas';

const MAX_WALLPAPER_BYTES = 2 * 1024 * 1024; // 2 MB
const SAFE_DATA_IMAGE_REGEX = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i;
const SAFE_HTTPS_URL_REGEX = /^https:\/\/[^\s"'()<>]+$/i;

function isValidWallpaperImage(image: unknown): image is string {
  if (typeof image !== 'string') return false;
  if (image.length === 0 || image.length > MAX_WALLPAPER_BYTES) return false;
  return SAFE_DATA_IMAGE_REGEX.test(image) || SAFE_HTTPS_URL_REGEX.test(image);
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();
    const wallpapers = await Wallpaper.find({ userId: session.user.email }).sort({ uploadedAt: -1 });
    return NextResponse.json({ wallpapers });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch wallpapers' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsedBody = await parseJsonBody<{ image?: unknown }>(req);
    if (!parsedBody.ok) {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    const { image } = parsedBody.data;
    if (!isValidWallpaperImage(image)) {
      return NextResponse.json(
        { error: 'Invalid image format or size (max 2MB PNG/JPEG/WEBP/GIF)' },
        { status: 400 }
      );
    }

    await dbConnect();
    const existingActive = await Wallpaper.exists({ userId: session.user.email, isActive: true });
    const newWallpaper = await Wallpaper.create({
      userId: session.user.email,
      image,
      isActive: !existingActive,
    });

    return NextResponse.json(newWallpaper, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to upload wallpaper' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsedBody = await parseJsonBody<{ id?: unknown; action?: unknown }>(req);
    if (!parsedBody.ok) {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    const { id, action } = parsedBody.data;
    if (action !== 'setActive') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const idCheck = objectIdSchema.safeParse(id);
    if (!idCheck.success) {
      return NextResponse.json({ error: 'Invalid wallpaper ID' }, { status: 400 });
    }

    await dbConnect();

    const target = await Wallpaper.findOne({ _id: idCheck.data, userId: session.user.email });
    if (!target) {
      return NextResponse.json({ error: 'Wallpaper not found' }, { status: 404 });
    }

    await Wallpaper.updateMany(
      { userId: session.user.email, _id: { $ne: idCheck.data } },
      { $set: { isActive: false } }
    );
    await Wallpaper.updateOne(
      { _id: idCheck.data, userId: session.user.email },
      { $set: { isActive: true } }
    );

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to update wallpaper' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsedBody = await parseJsonBody<{ id?: unknown }>(req);
    if (!parsedBody.ok) {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    const idCheck = objectIdSchema.safeParse(parsedBody.data.id);
    if (!idCheck.success) {
      return NextResponse.json({ error: 'Invalid wallpaper ID' }, { status: 400 });
    }

    await dbConnect();
    const deleted = await Wallpaper.findOneAndDelete({
      _id: idCheck.data,
      userId: session.user.email,
    });

    if (!deleted) {
      return NextResponse.json({ error: 'Wallpaper not found' }, { status: 404 });
    }

    const activeExists = await Wallpaper.exists({ userId: session.user.email, isActive: true });
    if (!activeExists) {
      const first = await Wallpaper.findOne({ userId: session.user.email }).sort({ uploadedAt: -1 });
      if (first) {
        first.isActive = true;
        await first.save();
      }
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete wallpaper' }, { status: 500 });
  }
}
