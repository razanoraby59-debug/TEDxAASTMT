
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const multer = require("multer");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 5000;

// ==================== PROJECT DIRECTORIES ====================

const PROJECT_DIR = path.resolve(__dirname, "..");
const FRONTEND_DIR = path.join(PROJECT_DIR, "public");

// Vercel's filesystem is read-only except for /tmp.
const UPLOAD_DIR = process.env.VERCEL
    ? path.join("/tmp", "tedx-uploads")
    : path.join(__dirname, "uploads");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ==================== MIDDLEWARE ====================

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

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

// ==================== FRONTEND PAGES ====================

// Look in /public first, then the project root.
function findFrontendFile(filename) {
    const candidates = [
        path.join(FRONTEND_DIR, filename),
        path.join(PROJECT_DIR, filename)
    ];

    return candidates.find((filePath) => fs.existsSync(filePath));
}

// Homepage
app.get("/", (req, res) => {
    const homepage = findFrontendFile("frontend.html");

    if (!homepage) {
        return res.status(404).send(
            "Homepage not found. Put frontend.html in the public folder or project root."
        );
    }

    return res.sendFile(homepage);
});

// Other HTML pages
const htmlPages = [
    "join.html",
    "register.html",
    "signup.html",
    "login.html",
    "privacy.html",
    "terms.html",
    "rate.html"
];

for (const page of htmlPages) {
    app.get(`/${page}`, (req, res) => {
        const filePath = findFrontendFile(page);

        if (!filePath) {
            return res.status(404).send(
                `Page not found: ${page}. Put it in the public folder or project root.`
            );
        }

        return res.sendFile(filePath);
    });
}

// Serve static assets from /public.
app.use(express.static(FRONTEND_DIR));

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

// ==================== SIGN UP ====================

app.post("/signup", async (req, res) => {
    try {
        await connectDB();

        const { name, email, password } = req.body;

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

        const { email, password } = req.body;

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

        const isMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!isMatch) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        return res.json({
            message: "Login successful!",
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
        name: "TEDxAASTMT 2026"
    });

    if (!event) {
        try {
            event = await Event.create({
                name: "TEDxAASTMT 2026",
                totalSeats: 100,
                seatsRemaining: 100,
                registrationOpen: true
            });

        } catch (error) {
            if (error.code !== 11000) {
                throw error;
            }

            event = await Event.findOne({
                name: "TEDxAASTMT 2026"
            });
        }
    }

    return event;
}

// ==================== EVENT STATUS ====================

app.get("/event-status", async (req, res) => {
    try {
        const event = await ensureEvent();

        return res.json({
            seatsRemaining: event.seatsRemaining,
            totalSeats: event.totalSeats,
            registrationOpen:
                event.registrationOpen &&
                event.seatsRemaining > 0
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

        const {
            name,
            registration_number,
            email
        } = req.body;

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

            let event = await Event.findOne({
                name: "TEDxAASTMT 2026"
            }).session(session);

            if (!event) {
                const createdEvents = await Event.create(
                    [{
                        name: "TEDxAASTMT 2026",
                        totalSeats: 100,
                        seatsRemaining: 100,
                        registrationOpen: true
                    }],
                    { session }
                );

                event = createdEvents[0];
            }

            if (!event.registrationOpen) {
                throw new Error("REGISTRATION_CLOSED");
            }

            const updatedEvent = await Event.findOneAndUpdate(
                {
                    name: "TEDxAASTMT 2026",
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
                email: cleanEmail
            });

            await registration.save({ session });

            savedRegistration = {
                name: registration.name,
                registration_number: registration.registration_number,
                email: registration.email
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

// ==================== SUBMIT TEAM APPLICATION ====================

app.post(
    "/applications",

    // Process the optional uploaded sample.
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
                email,
                phone,
                college,
                team,
                why
            } = req.body;

            const cleanName =
                typeof name === "string" ? name.trim() : "";

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

            const application = await Application.create({
                name: cleanName,
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

            return res.status(500).json({
                message:
                    "We couldn't save your application. Please try again."
            });

        } finally {
            // Remove the uploaded file if saving the application failed.
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

        await Event.findOneAndUpdate(
            { name: "TEDxAASTMT 2026" },
            {
                $setOnInsert: {
                    name: "TEDxAASTMT 2026",
                    totalSeats: 100,
                    seatsRemaining: 100,
                    registrationOpen: true
                }
            },
            {
                upsert: true,
                returnDocument: "after"
            }
        );

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
// Vercel imports the Express app through index.js.
if (require.main === module) {
    startServer();
}

module.exports = app;
