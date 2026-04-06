import mongoose from 'mongoose';

const TeamUserSchema = new mongoose.Schema({
  id: { type: String, required: true },
  role: { type: String, required: true }
});

const TeamUser = mongoose.models.TeamUser || mongoose.model('TeamUser', TeamUserSchema);

export default TeamUser;