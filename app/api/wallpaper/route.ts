import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import dbConnect from "@/lib/db_connect";
import Wallpaper from "@/lib/models/Wallpaper";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await dbConnect();
    const wallpapers = await Wallpaper.find({ userId: session.user.email }).sort({ uploadedAt: -1 });
    return NextResponse.json({ wallpapers });
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch wallpapers" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { image } = await req.json();
    if (!image) return NextResponse.json({ error: "No image provided" }, { status: 400 });

    await dbConnect();
    // if it's the first one, make it active
    const count = await Wallpaper.countDocuments({ userId: session.user.email });
    const newWallpaper = await Wallpaper.create({
      userId: session.user.email,
      image,
      isActive: count === 0
    });
    
    return NextResponse.json(newWallpaper);
  } catch (err) {
    return NextResponse.json({ error: "Failed to upload wallpaper" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id, action } = await req.json();
    await dbConnect();

    if (action === "setActive") {
      await Wallpaper.updateMany({ userId: session.user.email }, { isActive: false });
      await Wallpaper.findOneAndUpdate({ _id: id, userId: session.user.email }, { isActive: true });
      return NextResponse.json({ success: true });
    }
    
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: "Failed to update wallpaper" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await req.json();
    await dbConnect();
    await Wallpaper.findOneAndDelete({ _id: id, userId: session.user.email });
    
    // If we deleted the active one, maybe make the first remaining one active
    const activeExists = await Wallpaper.exists({ userId: session.user.email, isActive: true });
    if (!activeExists) {
      const first = await Wallpaper.findOne({ userId: session.user.email });
      if (first) {
        first.isActive = true;
        await first.save();
      }
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: "Failed to delete wallpaper" }, { status: 500 });
  }
}