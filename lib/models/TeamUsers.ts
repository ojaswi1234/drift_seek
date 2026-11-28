import mongoose from 'mongoose';

const TeamUserSchema = new mongoose.Schema(
  {
    ownerEmail: { type: String, required: true, index: true },
    roomId: { type: String, required: true, default: 'default', index: true },
    userId: { type: String, required: true },
    role: { type: String, enum: ['Editor', 'Viewer'], required: true },
  },
  { timestamps: true }
);

TeamUserSchema.index({ ownerEmail: 1, roomId: 1, userId: 1 }, { unique: true });

const TeamUser = mongoose.models.TeamUser || mongoose.model('TeamUser', TeamUserSchema);

export default TeamUser;
