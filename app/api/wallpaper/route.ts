import { NextResponse } from "next/server";
import dbConnect from "@/lib/db_connect";
import Wallpaper from "@/lib/models/Wallpaper";

export async function GET() {
  try {
    await dbConnect();
    const wallpapers = await Wallpaper.find().sort({ uploadedAt: -1 });
    return NextResponse.json({ wallpapers });
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch wallpapers" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { image } = await req.json();
    if (!image) return NextResponse.json({ error: "No image provided" }, { status: 400 });

    await dbConnect();
    // if it's the first one, make it active
    const count = await Wallpaper.countDocuments();
    const newWallpaper = await Wallpaper.create({
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
    const { id, action } = await req.json();
    await dbConnect();

    if (action === "setActive") {
      await Wallpaper.updateMany({}, { isActive: false });
      await Wallpaper.findByIdAndUpdate(id, { isActive: true });
      return NextResponse.json({ success: true });
    }
    
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: "Failed to update wallpaper" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();
    await dbConnect();
    await Wallpaper.findByIdAndDelete(id);
    // If we deleted the active one, maybe make the first remaining one active
    const activeExists = await Wallpaper.exists({ isActive: true });
    if (!activeExists) {
      const first = await Wallpaper.findOne();
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