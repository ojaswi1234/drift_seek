import mongoose from 'mongoose';

const TeamUserSchema = new mongoose.Schema({
  teamId: { type: String, required: true, index: true },
  userId: { type: String, required: true },
  role: { type: String, required: true, enum: ["Editor", "Viewer"] }
});

TeamUserSchema.index({ teamId: 1, userId: 1 }, { unique: true });

const TeamUser = mongoose.models.TeamUser || mongoose.model('TeamUser', TeamUserSchema);

export default TeamUser;