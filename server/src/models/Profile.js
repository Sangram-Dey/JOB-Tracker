import mongoose from 'mongoose';

// One master profile per user. Every later tailored resume may only use facts from `data`.
const profileSchema = new mongoose.Schema(
  {
    // Every document carries userId and every query filters by it: this is what makes multi-user possible later.
    // Users live in Clerk, so this is Clerk's user id string (e.g. "user_2abc…"), not a Mongo ObjectId.
    userId: { type: String, required: true, unique: true },
    // The resume as structured JSON. Its shape is defined and validated by Zod (schemas/profile.js),
    // so Mongo stores it as a plain object instead of repeating the schema here.
    // Not required: saving preferences before uploading a resume creates a profile without data.
    data: Object,
    sourceFileName: String,
    uploadedData: Object, // `data` as the last upload read it: the Resume page's "Reset" goes back to this
    // The PDF attached to every application email, stored in GridFS (resume/storage.js).
    resumePdf: { id: mongoose.Schema.Types.ObjectId, name: String, size: Number, savedAt: Date },
    applyAnswers: Object, // standard answers for application forms, validated by schemas/applyAnswers.js
    emailsPreparedOn: String, // "2026-11-13": the day the morning emails were last prepared (mail/prepare.js)
    summarySentOn: String, // the day the morning summary email was last sent (tracker/summary.js)
    // Job search preferences, validated by schemas/preferences.js. Kept apart from data so a new upload never wipes them.
    preferences: Object,
    // The Gmail this user sends from (mail/send.js). secret = the app password, encrypted; never selected by default.
    mailAccount: { provider: String, user: String, secret: { type: String, select: false }, verifiedAt: Date }, // provider: mail/providers.js
  },
  { timestamps: true, minimize: false },
);

export const Profile = mongoose.model('Profile', profileSchema);
