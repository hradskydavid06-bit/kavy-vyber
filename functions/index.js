const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

const ONESIGNAL_APP_ID = "6383d18a-bae9-4e58-b577-39e9c58c3fe2";

exports.sendCuppingNotification = onDocumentCreated("cuppings/{cuppingId}", async (event) => {
    const cuppingId = event.params.cuppingId;

    // Ignorovat konfigurační a pomocné záznamy
    if (cuppingId === "config_onesignal") {
        return null;
    }

    const snapshot = event.data;
    if (!snapshot) {
        console.log("No data associated with the event");
        return null;
    }

    const data = snapshot.data();
    if (!data || !data.title) {
        console.log("Incomplete cupping document:", data);
        return null;
    }

    // 1. Získání REST API klíče z proměnné prostředí nebo z konfigurace ve Firestore
    let apiKey = process.env.ONESIGNAL_REST_API_KEY;
    if (!apiKey) {
        try {
            const configSnap = await db.collection("cuppings").doc("config_onesignal").get();
            if (configSnap.exists) {
                apiKey = configSnap.data().key;
            }
        } catch (e) {
            console.error("Failed to read config_onesignal from Firestore:", e);
        }
    }

    if (!apiKey) {
        console.error("OneSignal REST API Key is not set in environment or config_onesignal!");
        return null;
    }

    const cleanKey = apiKey.trim();
    const authHeader = cleanKey.startsWith("Basic ") || cleanKey.startsWith("Key ")
        ? cleanKey
        : `Basic ${cleanKey}`;

    // 2. Formátování data a času (YYYY-MM-DD -> DD.MM.YYYY)
    let formattedDate = data.date || "";
    if (formattedDate.includes("-")) {
        const parts = formattedDate.split("-");
        if (parts.length === 3) {
            formattedDate = `${parts[2]}.${parts[1]}.${parts[0]}`;
        }
    }
    const timeStr = data.time ? ` v ${data.time}` : "";

    const titleText = `Nový Cupping! ☕`;
    const messageText = `Byl vypsán nový cupping: ${data.title} dne ${formattedDate}${timeStr}.`;

    const payload = {
        app_id: ONESIGNAL_APP_ID,
        // Cílíme na přihlášená zařízení (podpora obou běžných segmentů)
        included_segments: ["Total Subscriptions", "Subscribed Users"],
        headings: {
            cs: titleText,
            en: `New Cupping! ☕`
        },
        contents: {
            cs: messageText,
            en: `New cupping scheduled: ${data.title} on ${formattedDate}${timeStr}.`
        },
        url: `https://hradskydavid06-bit.github.io/kavy-vyber/?cuppingId=${cuppingId}`,
        web_buttons: [
            {
                id: "going",
                text: "Jdu 👍",
                url: `https://hradskydavid06-bit.github.io/kavy-vyber/?cuppingId=${cuppingId}&attendance=yes`
            },
            {
                id: "decline",
                text: "Nejdu 👎",
                url: `https://hradskydavid06-bit.github.io/kavy-vyber/?cuppingId=${cuppingId}&attendance=no`
            }
        ]
    };

    console.log(`Sending OneSignal notification for cupping "${data.title}" (${cuppingId})...`);

    try {
        const response = await fetch("https://onesignal.com/api/v1/notifications", {
            method: "POST",
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Authorization": authHeader
            },
            body: JSON.stringify(payload)
        });

        const resText = await response.text();
        console.log(`OneSignal response status: ${response.status}`);
        console.log(`OneSignal response body: ${resText}`);
        return { status: response.status, body: resText };
    } catch (err) {
        console.error("Failed to send notification via OneSignal:", err);
        throw err;
    }
});
