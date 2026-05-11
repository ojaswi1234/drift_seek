import mongoose from 'mongoose';

const WallpaperSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  image: { type: String, required: true },
  isActive: { type: Boolean, default: false },
  uploadedAt: { type: Date, default: Date.now }
});

const Wallpaper = mongoose.models.Wallpaper || mongoose.model('Wallpaper', WallpaperSchema);

export default Wallpaper;
