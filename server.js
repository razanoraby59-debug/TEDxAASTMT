require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const ExcelJS = require("exceljs");
const multer = require("multer");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 5000;

// EVENT CONFIGURATION
const EVENT_CAPACITY = 150;
const EVENT_NAME = "TEDxAASTMT 2026";

// ==================== PROJECT DIRECTORIES ====================

const PROJECT_DIR = __dirname;
const FRONTEND_DIR = path.join(PROJECT_DIR, "public");

const UPLOAD_DIR = process.env.VERCEL
    ? path.join("/tmp", "tedx-uploads")
    : path.join(__dirname, "uploads");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ==================== MIDDLEWARE ====================

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use(express.static(FRONTEND_DIR));

// ==================== FILE UPLOADS ====================

const allowedExtensions = new Set([
    ".pdf",
    ".doc",
    ".docx",
    ".ppt",
    ".pptx",
    ".png",
    ".jpg",
    ".jpeg",
    ".mp4",
    ".zip"
]);

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, UPLOAD_DIR);
        },

        filename: (req, file, cb) => {
            const extension = path.extname(file.originalname).toLowerCase();
            cb(null, `${crypto.randomUUID()}${extension}`);
        }
    }),

    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1
    },

    fileFilter: (req, file, cb) => {
        const extension = path.extname(file.originalname).toLowerCase();

        if (!allowedExtensions.has(extension)) {
            return cb(
                new Error(
                    "Unsupported file type. Allowed: PDF, DOC, DOCX, PPT, PPTX, PNG, JPG, JPEG, MP4, ZIP."
                )
            );
        }

        cb(null, true);
    }
});

// ==================== MONGODB CONNECTION ====================

let mongoPromise = null;

async function connectDB() {
    if (mongoose.connection.readyState === 1) {
        return;
    }

    if (!process.env.MONGODB_URI) {
        throw new Error("MONGODB_URI is not configured.");
    }

    if (!mongoPromise) {
        mongoPromise = mongoose
            .connect(process.env.MONGODB_URI, {
                serverSelectionTimeoutMS: 10000
            })
            .catch((error) => {
                mongoPromise = null;
                throw error;
            });
    }

    await mongoPromise;
}

// ==================== USER SCHEMA ====================

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 120
    },

    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        maxlength: 254
    },

    password: {
        type: String,
        required: true
    }
});

const User = mongoose.model("User", userSchema);

// ==================== EVENT SCHEMA ====================

const eventSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },

    totalSeats: {
        type: Number,
        required: true,
        min: 0
    },

    seatsRemaining: {
        type: Number,
        required: true,
        min: 0
    },

    registrationOpen: {
        type: Boolean,
        default: true
    },

    eventDate: {
        type: Date,
        default: null
    },

    eventTime: {
        type: String,
        default: null,
        trim: true,
        maxlength: 60
    },

    location: {
        type: String,
        default: null,
        trim: true,
        maxlength: 200
    }
});

const Event = mongoose.model("Event", eventSchema);

// ==================== EVENT REGISTRATION SCHEMA ====================

const registrationSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 120
    },

    registration_number: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },

    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        maxlength: 254
    },

    registeredAt: {
        type: Date,
        default: Date.now
    },

    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
        index: true
    },

    ticketToken: {
        type: String,
        unique: true,
        sparse: true
    },

    ticketId: {
        type: String
    },

    status: {
        type: String,
        enum: ["registered", "checked_in", "invalid"],
        default: "registered"
    },

    checkedInAt: {
        type: Date,
        default: null
    }
});

const Registration = mongoose.model(
    "Registration",
    registrationSchema
);

// ==================== TEAM APPLICATION SCHEMA ====================

const applicationSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 120
    },

    studentId: {
        type: String,
        required: true,
        trim: true,
        match: /^\d{9}$/
    },

    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        maxlength: 254
    },

    phone: {
        type: String,
        required: true,
        trim: true,
        maxlength: 30
    },

    college: {
        type: String,
        required: true,
        trim: true,
        maxlength: 150
    },

    team: {
        type: String,
        required: true,
        enum: [
            "Coaches",
            "Operation & PR",
            "Media & Marketing",
            "HR"
        ]
    },

    why: {
        type: String,
        required: true,
        trim: true,
        maxlength: 3000
    },

    sampleName: {
        type: String,
        default: null,
        maxlength: 255
    },

    samplePath: {
        type: String,
        default: null
    },

    status: {
        type: String,
        enum: ["pending", "accepted", "rejected"],
        default: "pending"
    },

    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Application = mongoose.model(
    "Application",
    applicationSchema,
    "applications"
);

// ==================== UNIQUE APPLICATION STUDENT ID ====================

// This index prevents duplicate student IDs.
// The partial filter preserves older applications that do not
// yet have a studentId field.

let applicationStudentIdIndexPromise = null;

async function ensureApplicationStudentIdIndex() {
    if (!applicationStudentIdIndexPromise) {
        applicationStudentIdIndexPromise =
            Application.collection.createIndex(
                { studentId: 1 },
                {
                    unique: true,
                    partialFilterExpression: {
                        studentId: { $type: "string" }
                    },
                    name: "unique_application_student_id"
                }
            ).catch((error) => {
                applicationStudentIdIndexPromise = null;
                throw error;
            });
    }

    await applicationStudentIdIndexPromise;
}

// ==================== AUTH TOKENS ====================

const TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function signToken(userId) {
    const payload = Buffer.from(
        JSON.stringify({
            sub: String(userId),
            exp: Date.now() + TOKEN_LIFETIME_MS
        })
    ).toString("base64url");

    const signature = crypto
        .createHmac("sha256", process.env.AUTH_SECRET)
        .update(payload)
        .digest("base64url");

    return `${payload}.${signature}`;
}

function verifyToken(token) {
    if (!process.env.AUTH_SECRET || typeof token !== "string") {
        return null;
    }

    const parts = token.split(".");

    if (parts.length !== 2) {
        return null;
    }

    const [payload, signature] = parts;

    const expected = crypto
        .createHmac("sha256", process.env.AUTH_SECRET)
        .update(payload)
        .digest("base64url");

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return null;
    }

    try {
        const data = JSON.parse(
            Buffer.from(payload, "base64url").toString("utf8")
        );

        if (!data.exp || data.exp < Date.now() || !data.sub) {
            return null;
        }

        return data.sub;
    } catch {
        return null;
    }
}

function bearerToken(req) {
    const header = req.headers.authorization || "";

    return header.startsWith("Bearer ")
        ? header.slice(7)
        : null;
}

async function getOptionalUser(req) {
    const userId = verifyToken(bearerToken(req));

    if (!userId || !mongoose.isValidObjectId(userId)) {
        return null;
    }

    return User.findById(userId).select("-password");
}

async function requireAuth(req, res, next) {
    try {
        await connectDB();

        const user = await getOptionalUser(req);

        if (!user) {
            return res.status(401).json({
                message: "Please log in to continue."
            });
        }

        req.user = user;
        next();

    } catch (error) {
        console.error("AUTH ERROR:", error);

        return res.status(500).json({
            message: "Server error."
        });
    }
}

// ==================== CSV EXPORT SECURITY ====================

function requireCheckinKey(req, res, next) {
    const expected = process.env.CHECKIN_KEY;

    if (!expected) {
        return res.status(500).json({
            message: "CHECKIN_KEY is not configured on the server."
        });
    }

    const provided = String(req.headers["x-checkin-key"] || "");

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(403).json({
            message: "Invalid check-in key."
        });
    }

    next();
}

function newTicketFields() {
    return {
        ticketToken: crypto.randomBytes(24).toString("hex"),
        ticketId: `TDX-${crypto.randomBytes(4).toString("hex").toUpperCase()}`
    };
}

// ==================== APPLICATION EXPORT SECURITY ====================

function requireApplicationsExportKey(req, res, next) {
    const expected = process.env.APPLICATIONS_EXPORT_KEY;

    if (!expected) {
        return res.status(500).json({
            message: "APPLICATIONS_EXPORT_KEY is not configured."
        });
    }

    const provided = String(
        req.headers["x-applications-export-key"] || ""
    );

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);

    if (
        a.length !== b.length ||
        !crypto.timingSafeEqual(a, b)
    ) {
        return res.status(403).json({
            message: "Invalid applications export key."
        });
    }

    next();
}

// ==================== SIGN UP ====================

app.post("/signup", async (req, res) => {
    try {
        await connectDB();

        const { name, email, password } = req.body || {};

        if (
            typeof name !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string" ||
            !name.trim() ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                message: "Please fill in all fields."
            });
        }

        const cleanName = name.trim();
        const cleanEmail = email.trim().toLowerCase();

        if (cleanName.length > 120 || cleanEmail.length > 254) {
            return res.status(400).json({
                message: "Name or email is too long."
            });
        }

        if (password.length < 8 || password.length > 128) {
            return res.status(400).json({
                message: "Password must be between 8 and 128 characters."
            });
        }

        const existingUser = await User.findOne({
            email: cleanEmail
        });

        if (existingUser) {
            return res.status(400).json({
                message: "An account with this email already exists."
            });
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        await User.create({
            name: cleanName,
            email: cleanEmail,
            password: hashedPassword
        });

        return res.status(201).json({
            message: "Account created successfully!"
        });

    } catch (error) {
        console.error("SIGNUP ERROR:", error);

        if (error.code === 11000) {
            return res.status(400).json({
                message: "An account with this email already exists."
            });
        }

        return res.status(500).json({
            message: "Server error."
        });
    }
});

// ==================== LOGIN ====================

app.post("/login", async (req, res) => {
    try {
        await connectDB();

        if (!process.env.AUTH_SECRET) {
            console.error("LOGIN ERROR: AUTH_SECRET is not configured.");

            return res.status(500).json({
                message: "Server is not configured for login."
            });
        }

        const { email, password } = req.body || {};

        if (
            typeof email !== "string" ||
            typeof password !== "string" ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                message: "Please enter your email and password."
            });
        }

        const cleanEmail = email.trim().toLowerCase();

        const user = await User.findOne({
            email: cleanEmail
        });

        if (!user) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        const storedPassword = user.password;

        const isBcryptHash =
            /^\$2[aby]\$\d{2}\$/.test(storedPassword);

        let isMatch = false;

        if (isBcryptHash) {
            isMatch = await bcrypt.compare(password, storedPassword);
        } else {
            // Support accounts created by the older plain-text signup code.
            isMatch = password === storedPassword;

            if (isMatch) {
                user.password = await bcrypt.hash(password, 12);
                await user.save();

                console.log("Legacy password securely migrated.");
            }
        }

        if (!isMatch) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        return res.json({
            message: "Login successful!",
            token: signToken(user._id),
            user: {
                name: user.name,
                email: user.email
            }
        });

    } catch (error) {
        console.error("LOGIN ERROR:", error);

        return res.status(500).json({
            message: "Server error."
        });
    }
});

// ==================== ENSURE EVENT EXISTS ====================

async function ensureEvent() {
    await connectDB();

    let event = await Event.findOne({
        name: EVENT_NAME
    });

    if (!event) {
        event = await Event.create({
            name: EVENT_NAME,
            totalSeats: EVENT_CAPACITY,
            seatsRemaining: EVENT_CAPACITY,
            registrationOpen: true
        });

        return event;
    }

    if (event.totalSeats !== EVENT_CAPACITY) {
        const registeredCount = await Registration.countDocuments({
            status: { $in: ["registered", "checked_in"] }
        });

        event = await Event.findOneAndUpdate(
            { name: EVENT_NAME },
            {
                $set: {
                    totalSeats: EVENT_CAPACITY,
                    seatsRemaining: Math.max(
                        EVENT_CAPACITY - registeredCount,
                        0
                    )
                }
            },
            { returnDocument: "after" }
        );
    }

    return event;
}

// ==================== EVENT STATUS ====================

app.get("/event-status", async (req, res) => {
    try {
        const event = await ensureEvent();

        const registeredCount = await Registration.countDocuments({
            status: { $in: ["registered", "checked_in"] }
        });

        const checkedInCount = await Registration.countDocuments({
            status: "checked_in"
        });

        return res.json({
            registeredCount,
            seatsRemaining: event.seatsRemaining,
            checkedInCount,
            registrationOpen:
                event.registrationOpen &&
                event.seatsRemaining > 0,
            eventDate: event.eventDate || null,
            eventTime: event.eventTime || null,
            location: event.location || null
        });

    } catch (error) {
        console.error("EVENT STATUS ERROR:", error);

        return res.status(500).json({
            message: "Failed to load event status."
        });
    }
});

// ==================== REGISTER FOR THE EVENT ====================

app.post("/register", async (req, res) => {
    let session = null;

    try {
        await connectDB();
        await ensureEvent();

        const {
            name,
            registration_number,
            email
        } = req.body || {};

        if (
            typeof name !== "string" ||
            typeof registration_number !== "string" ||
            typeof email !== "string" ||
            !name.trim() ||
            !registration_number.trim() ||
            !email.trim()
        ) {
            return res.status(400).json({
                message: "Please fill in all fields."
            });
        }

        const cleanName = name.trim();
        const cleanEmail = email.trim().toLowerCase();
        const cleanRegNo = registration_number.trim();

        if (cleanName.length < 3 || cleanName.length > 120) {
            return res.status(400).json({
                message: "Please enter your full name."
            });
        }

        if (!/^\d{9}$/.test(cleanRegNo)) {
            return res.status(400).json({
                message: "Registration number must be exactly 9 digits."
            });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
            return res.status(400).json({
                message: "Please enter a valid email address."
            });
        }

        let owner = await getOptionalUser(req);

        if (!owner) {
            owner = await User.findOne({
                email: cleanEmail
            }).select("-password");
        }

        session = await mongoose.startSession();

        let savedRegistration = null;

        await session.withTransaction(async () => {
            const existingByEmail = await Registration.findOne({
                email: cleanEmail
            }).session(session);

            if (existingByEmail) {
                throw new Error("EMAIL_ALREADY_REGISTERED");
            }

            const existingByRegNo = await Registration.findOne({
                registration_number: cleanRegNo
            }).session(session);

            if (existingByRegNo) {
                throw new Error(
                    "REGISTRATION_NUMBER_ALREADY_REGISTERED"
                );
            }

            if (owner) {
                const existingForUser = await Registration.findOne({
                    user: owner._id
                }).session(session);

                if (existingForUser) {
                    throw new Error("ACCOUNT_ALREADY_REGISTERED");
                }
            }

            const event = await Event.findOne({
                name: EVENT_NAME
            }).session(session);

            if (!event) {
                throw new Error("EVENT_NOT_FOUND");
            }

            if (!event.registrationOpen) {
                throw new Error("REGISTRATION_CLOSED");
            }

            const updatedEvent = await Event.findOneAndUpdate(
                {
                    name: EVENT_NAME,
                    registrationOpen: true,
                    seatsRemaining: { $gt: 0 }
                },
                {
                    $inc: { seatsRemaining: -1 }
                },
                {
                    returnDocument: "after",
                    session
                }
            );

            if (!updatedEvent) {
                throw new Error("EVENT_FULL");
            }

            const registration = new Registration({
                name: cleanName,
                registration_number: cleanRegNo,
                email: cleanEmail,
                user: owner ? owner._id : null,
                ...newTicketFields()
            });

            await registration.save({ session });

            savedRegistration = {
                name: registration.name,
                registration_number: registration.registration_number,
                email: registration.email,
                ticketId: registration.ticketId
            };
        });

        return res.status(201).json({
            message: "Seat reserved successfully!",
            registration: savedRegistration
        });

    } catch (error) {
        console.error("REGISTRATION ERROR:", error);

        if (error.message === "EMAIL_ALREADY_REGISTERED") {
            return res.status(400).json({
                message: "This email is already registered."
            });
        }

        if (
            error.message ===
            "REGISTRATION_NUMBER_ALREADY_REGISTERED"
        ) {
            return res.status(400).json({
                message: "This registration number is already registered."
            });
        }

        if (error.message === "ACCOUNT_ALREADY_REGISTERED") {
            return res.status(400).json({
                message: "This account already has a registration."
            });
        }

        if (error.message === "EVENT_FULL") {
            return res.status(400).json({
                message: "Sorry, all seats are full."
            });
        }

        if (error.message === "REGISTRATION_CLOSED") {
            return res.status(400).json({
                message: "Event registration is currently closed."
            });
        }

        if (error.message === "EVENT_NOT_FOUND") {
            return res.status(500).json({
                message: "Event could not be found."
            });
        }

        if (error.code === 11000) {
            const duplicateField = Object.keys(
                error.keyPattern || {}
            )[0];

            if (duplicateField === "email") {
                return res.status(400).json({
                    message: "This email is already registered."
                });
            }

            if (duplicateField === "registration_number") {
                return res.status(400).json({
                    message: "This registration number is already registered."
                });
            }

            return res.status(400).json({
                message: "This registration already exists."
            });
        }

        return res.status(500).json({
            message:
                "Something went wrong while reserving your seat. Please try again."
        });

    } finally {
        if (session) {
            await session.endSession();
        }
    }
});

// ==================== PROFILE: ACCOUNT INFO ====================

app.get("/api/me", requireAuth, async (req, res) => {
    try {
        const registration = await Registration.findOne({
            $or: [
                { user: req.user._id },
                { email: req.user.email }
            ]
        }).select("registration_number");

        return res.json({
            name: req.user.name,
            email: req.user.email,
            createdAt: req.user._id.getTimestamp(),
            registrationNumber: registration
                ? registration.registration_number
                : null
        });

    } catch (error) {
        console.error("ME ERROR:", error);

        return res.status(500).json({
            message: "Server error."
        });
    }
});

// ==================== PROFILE: MY TICKET ====================

const STATUS_MESSAGES = {
    registered: "Registered â€“ Your ticket is ready!",
    checked_in: "Checked In â€“ You have been checked in successfully.",
    invalid: "Invalid â€“ This ticket is not valid."
};

app.get("/api/ticket", requireAuth, async (req, res) => {
    try {
        let registration = await Registration.findOne({
            $or: [
                { user: req.user._id },
                { email: req.user.email }
            ]
        });

        if (!registration) {
            return res.json({ registered: false });
        }

        let changed = false;

        if (!registration.user) {
            registration.user = req.user._id;
            changed = true;
        }

        if (!registration.ticketToken) {
            Object.assign(registration, newTicketFields());
            changed = true;
        }

        if (changed) {
            await registration.save();
        }

        const event = await ensureEvent();

        return res.json({
            registered: true,

            attendee: {
                name: registration.name
            },

            event: {
                name: event.name,
                date: event.eventDate || null,
                time: event.eventTime || null,
                location: event.location || null
            },

            ticket: {
                ticketId: registration.ticketId,
                token: registration.ticketToken,
                status: registration.status,
                statusMessage: STATUS_MESSAGES[registration.status],
                checkedInAt: registration.checkedInAt
            }
        });

    } catch (error) {
        console.error("TICKET ERROR:", error);

        return res.status(500).json({
            message: "Server error."
        });
    }
});

// ==================== CHECK-IN ====================

app.post("/api/checkin", async (req, res) => {
    try {
        await connectDB();

        const { token } = req.body || {};

        if (
            typeof token !== "string" ||
            !/^[a-f0-9]{48}$/.test(token.trim())
        ) {
            return res.status(400).json({
                result: "invalid",
                message: "This is not a valid TEDxAASTMT ticket."
            });
        }

        const cleanToken = token.trim();

        const checkedIn = await Registration.findOneAndUpdate(
            {
                ticketToken: cleanToken,
                status: "registered"
            },
            {
                $set: {
                    status: "checked_in",
                    checkedInAt: new Date()
                }
            },
            {
                returnDocument: "after"
            }
        );

        if (checkedIn) {
            return res.json({
                result: "ok",
                message: "Check-in successful.",
                name: checkedIn.name,
                ticketId: checkedIn.ticketId
            });
        }

        const existing = await Registration.findOne({
            ticketToken: cleanToken
        });

        if (!existing) {
            return res.status(404).json({
                result: "invalid",
                message: "Ticket not found."
            });
        }

        if (existing.status === "checked_in") {
            return res.status(409).json({
                result: "already_used",
                message: "This ticket has already been used.",
                name: existing.name,
                ticketId: existing.ticketId,
                checkedInAt: existing.checkedInAt
            });
        }

        return res.status(403).json({
            result: "invalid",
            message: "This ticket is not valid.",
            name: existing.name,
            ticketId: existing.ticketId
        });

    } catch (error) {
        console.error("CHECKIN ERROR:", error);

        return res.status(500).json({
            message: "Server error."
        });
    }
});

// ==================== ATTENDANCE CSV EXPORT ====================

function csvCell(value) {
    const text = value === null || value === undefined
        ? ""
        : String(value);

    return `"${text.replace(/"/g, '""')}"`;
}

function cairoTimestamp(date) {
    if (!date) return "";

    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Cairo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    }).format(new Date(date));
}

app.get(
    "/api/attendance.csv",
    requireCheckinKey,
    async (req, res) => {
        try {
            await connectDB();

            const checkedInOnly =
                req.query.checkedInOnly === "true";

            const filter = checkedInOnly
                ? { status: "checked_in" }
                : {};

            const registrations = await Registration.find(filter)
                .select(
                    "name registration_number email ticketId status checkedInAt"
                )
                .sort({ registeredAt: 1 })
                .lean();

            const headers = [
                "Name",
                "Registration Number",
                "Email",
                "Ticket ID",
                "Status",
                "Check-in Timestamp (Africa/Cairo)"
            ];

            const rows = registrations.map((registration) => [
                registration.name,
                registration.registration_number,
                registration.email,
                registration.ticketId,
                registration.status,
                cairoTimestamp(registration.checkedInAt)
            ]);

            const csv = [
                headers.map(csvCell).join(","),
                ...rows.map((row) => row.map(csvCell).join(","))
            ].join("\r\n");

            res.setHeader(
                "Content-Type",
                "text/csv; charset=utf-8"
            );

            res.setHeader(
                "Content-Disposition",
                `attachment; filename="tedxaastmt-attendance-${checkedInOnly ? "checked-in" : "all"}.csv"`
            );

            return res.send("\uFEFF" + csv);

        } catch (error) {
            console.error("ATTENDANCE EXPORT ERROR:", error);

            return res.status(500).json({
                message: "Failed to export attendance."
            });
        }
    }
);

// ==================== APPLICATIONS EXCEL EXPORT ====================

function safeExcelText(value) {
    const text = value === null || value === undefined
        ? ""
        : String(value);

    // Prevent spreadsheet formula injection.
    return /^[\s]*[=+\-@]/.test(text)
        ? "'" + text
        : text;
}

app.get(
    "/api/applications.xlsx",
    requireApplicationsExportKey,
    async (req, res) => {
        try {
            await connectDB();

            const applications = await Application.find({})
                .select(
                    "studentId name email phone college team why sampleName status createdAt"
                )
                .sort({ createdAt: -1 })
                .lean();

            const workbook = new ExcelJS.Workbook();

            workbook.creator = "TEDxAASTMT";
            workbook.created = new Date();

            const worksheet = workbook.addWorksheet("Applications");

            worksheet.columns = [
                { header: "Student ID", key: "studentId", width: 16 },
                { header: "Name", key: "name", width: 25 },
                { header: "Email", key: "email", width: 32 },
                { header: "Phone", key: "phone", width: 20 },
                { header: "College / Major", key: "college", width: 28 },
                { header: "Preferred Team", key: "team", width: 24 },
                { header: "Why They Applied", key: "why", width: 55 },
                { header: "Work Sample", key: "sampleName", width: 30 },
                { header: "Application Status", key: "status", width: 20 },
                { header: "Submitted At (Cairo)", key: "createdAt", width: 28 }
            ];

            worksheet.getRow(1).font = {
                bold: true,
                color: { argb: "FFFFFFFF" }
            };

            worksheet.getRow(1).fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFEB0028" }
            };

            worksheet.views = [
                { state: "frozen", ySplit: 1 }
            ];

            worksheet.autoFilter = {
                from: "A1",
                to: "J1"
            };

            for (const application of applications) {
                worksheet.addRow({
                    studentId: safeExcelText(application.studentId),
                    name: safeExcelText(application.name),
                    email: safeExcelText(application.email),
                    phone: safeExcelText(application.phone),
                    college: safeExcelText(application.college),
                    team: safeExcelText(application.team),
                    why: safeExcelText(application.why),
                    sampleName: safeExcelText(application.sampleName),
                    status: safeExcelText(application.status),
                    createdAt: cairoTimestamp(application.createdAt)
                });
            }

            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber > 1) {
                    row.alignment = {
                        vertical: "top",
                        wrapText: true
                    };
                }
            });

            const buffer = await workbook.xlsx.writeBuffer();

            res.setHeader(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );

            res.setHeader(
                "Content-Disposition",
                'attachment; filename="TEDxAASTMT-Applications.xlsx"'
            );

            res.setHeader("Content-Length", buffer.length);

            return res.send(Buffer.from(buffer));

        } catch (error) {
            console.error("APPLICATIONS EXPORT ERROR:", error);

            return res.status(500).json({
                message: "Failed to export applications."
            });
        }
    }
);

// ==================== SUBMIT TEAM APPLICATION ====================

app.post(
    "/applications",

    (req, res, next) => {
        upload.single("sample")(req, res, (error) => {
            if (error) {
                const message =
                    error.code === "LIMIT_FILE_SIZE"
                        ? "File is too large. Maximum size is 10 MB."
                        : error.message;

                return res.status(400).json({ message });
            }

            next();
        });
    },

    async (req, res) => {
        let applicationSaved = false;

        try {
            await connectDB();

            const {
                name,
                studentId,
                email,
                phone,
                college,
                team,
                why
            } = req.body || {};

            const cleanName =
                typeof name === "string" ? name.trim() : "";

            const cleanStudentId =
                typeof studentId === "string"
                    ? studentId.trim()
                    : "";

            const cleanEmail =
                typeof email === "string"
                    ? email.trim().toLowerCase()
                    : "";

            const cleanPhone =
                typeof phone === "string" ? phone.trim() : "";

            const cleanCollege =
                typeof college === "string" ? college.trim() : "";

            const cleanWhy =
                typeof why === "string" ? why.trim() : "";

            const validTeams = [
                "Coaches",
                "Operation & PR",
                "Media & Marketing",
                "HR"
            ];

            if (
                !cleanName ||
                !cleanStudentId ||
                !cleanEmail ||
                !cleanPhone ||
                !cleanCollege ||
                !cleanWhy ||
                typeof team !== "string" ||
                !validTeams.includes(team)
            ) {
                return res.status(400).json({
                    message: "Please complete all required fields."
                });
            }

            if (!/^\d{9}$/.test(cleanStudentId)) {
                return res.status(400).json({
                    message:
                        "Your AASTMT registration number must contain exactly 9 digits."
                });
            }

            if (
                cleanName.length > 120 ||
                cleanEmail.length > 254 ||
                cleanPhone.length > 30 ||
                cleanCollege.length > 150 ||
                cleanWhy.length > 3000
            ) {
                return res.status(400).json({
                    message:
                        "One or more fields exceed the allowed length."
                });
            }

            if (
                !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)
            ) {
                return res.status(400).json({
                    message: "Please enter a valid email address."
                });
            }

            // Ensure the unique student ID index exists before saving.
            await ensureApplicationStudentIdIndex();

            // Give the applicant a friendly message if this ID was used.
            const existingApplication = await Application.findOne({
                studentId: cleanStudentId
            });

            if (existingApplication) {
                return res.status(409).json({
                    message:
                        "This student ID has already submitted an application. Only one application is allowed per student."
                });
            }

            const application = await Application.create({
                name: cleanName,
                studentId: cleanStudentId,
                email: cleanEmail,
                phone: cleanPhone,
                college: cleanCollege,
                team,
                why: cleanWhy,

                sampleName: req.file
                    ? path.basename(req.file.originalname).slice(0, 255)
                    : null,

                samplePath: req.file
                    ? req.file.path
                    : null
            });

            applicationSaved = true;

            return res.status(201).json({
                message:
                    "Your application has been submitted successfully!",
                applicationId: application._id
            });

        } catch (error) {
            console.error(
                "APPLICATION SUBMISSION ERROR:",
                error
            );

            // Handle duplicate IDs even if two submissions arrive together.
            if (
                error.code === 11000 &&
                error.keyPattern &&
                error.keyPattern.studentId
            ) {
                return res.status(409).json({
                    message:
                        "This student ID has already submitted an application. Only one application is allowed per student."
                });
            }

            return res.status(500).json({
                message:
                    "We couldn't save your application. Please try again."
            });

        } finally {
            if (req.file && !applicationSaved) {
                fs.unlink(req.file.path, (error) => {
                    if (error) {
                        console.error(
                            "UPLOAD CLEANUP ERROR:",
                            error
                        );
                    }
                });
            }
        }
    }
);

// ==================== HEALTH CHECK ====================

app.get("/status", (req, res) => {
    return res.json({
        status: "online",
        message: "TEDxAASTMT server is running."
    });
});

// ==================== START LOCAL SERVER ====================

async function startServer() {
    try {
        await connectDB();

        console.log("MongoDB connected successfully!");

        await ensureEvent();

        console.log("Event seat counter ready!");

        await Registration.init();

        console.log("Registration indexes ready!");

        await Application.init();

        console.log("Application collection ready!");

        app.listen(PORT, () => {
            console.log(
                `TEDxAASTMT server running on port ${PORT}`
            );
        });

    } catch (error) {
        console.error("SERVER STARTUP ERROR:", error);
        process.exitCode = 1;
    }
}

// Start a local server only when this file is run directly.
if (require.main === module) {
    startServer();
}

module.exports = app;
