let video, canvas, ctx;
let faceMesh;

let lastWarningTime = 0;
let warningCount = 0;
const MAX_WARNINGS = 3;

let faceDetectionCount = 0;
let noFaceCount = 0;
let lookAwayCount = 0;
let hasFocus = true;
let examTerminated = false; // 🔧 NEW

// ================= INIT =================
function initMonitoring() {
    video = document.getElementById('video-feed');
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');

    window.addEventListener('blur', () => {
        if (examTerminated) return;
        hasFocus = false;
        handleViolation('You switched tabs or applications');
        updateStatus('focus', 'danger', 'Focus: Lost ✗');
    });

    window.addEventListener('focus', () => {
        if (examTerminated) return;
        hasFocus = true;
        updateStatus('focus', 'ok', 'Focus: Active ✓');
    });

    document.addEventListener('visibilitychange', () => {
        if (examTerminated) return;
        if (document.hidden) {
            handleViolation('You left the exam tab');
            updateStatus('focus', 'danger', 'Focus: Lost ✗');
        } else {
            updateStatus('focus', 'ok', 'Focus: Active ✓');
        }
    });

    navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => {
            video.srcObject = stream;
            video.play();
            video.onloadedmetadata = () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                startFaceDetection();
            };
        })
        .catch(() => {
            alert('Camera access is required for this exam.');
        });
}

// ================= FACE DETECTION =================
function startFaceDetection() {
    faceMesh = new FaceMesh({
        locateFile: file =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`
    });

    faceMesh.setOptions({
        maxNumFaces: 2,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });

    faceMesh.onResults(onFaceResults);

    async function detectFrame() {
        if (!examTerminated) {
            await faceMesh.send({ image: video });
            requestAnimationFrame(detectFrame);
        }
    }
    detectFrame();
}

function onFaceResults(results) {
    if (examTerminated) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (results.multiFaceLandmarks?.length === 1) {
        noFaceCount = 0;
        updateStatus('face', 'ok', 'Face: Detected ✓');

        const landmarks = results.multiFaceLandmarks[0];
        const gaze = analyzeGaze(landmarks);

        if (gaze === 'Away') {
            lookAwayCount++;
            updateStatus('gaze', 'warning', 'Gaze: Away ⚠');

            if (lookAwayCount > 10) {
                handleViolation('Looking away from screen');
                lookAwayCount = 0;
            }
        } else {
            lookAwayCount = 0;
            updateStatus('gaze', 'ok', 'Gaze: Centered ✓');
        }
    }
    else if (results.multiFaceLandmarks?.length > 1) {
        handleViolation('Multiple faces detected');
        updateStatus('face', 'danger', 'Multiple Faces ✗');
    }
    else {
        noFaceCount++;
        updateStatus('face', 'warning', 'Face: Not detected');

        if (noFaceCount > 15) {
            handleViolation('Face not detected');
            noFaceCount = 0;
        }
    }
}

// ================= ANALYSIS =================
function analyzeGaze(landmarks) {
    const leftEye = landmarks[33];
    const rightEye = landmarks[263];
    const nose = landmarks[1];
    const eyeX = (leftEye.x + rightEye.x) / 2;
    return Math.abs(eyeX - nose.x) > 0.05 ? 'Away' : 'Center';
}

// ================= UI =================
function updateStatus(type, status, text) {
    const el = document.getElementById(`${type}-status`);
    if (!el) return;
    el.className = `status-indicator status-${status}`;
    el.textContent = text;
}

// ================= VIOLATIONS (FIXED) =================
function handleViolation(message) {
    if (examTerminated) return;                // 🔧 STOP after submit
    if (warningCount >= MAX_WARNINGS) return;  // 🔧 HARD LIMIT

    const now = Date.now();
    if (now - lastWarningTime < 5000) return;  // 🔧 debounce

    lastWarningTime = now;

    fetch('/student/issue-warning', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            warningCount = Math.min(data.warnings, MAX_WARNINGS); // 🔧 cap
            document.getElementById('warning-count').textContent = warningCount;

            const box = document.getElementById('violation-alert');
            document.getElementById('violation-message').textContent =
                `Warning ${warningCount}: ${message}`;
            box.style.display = 'block';

            setTimeout(() => box.style.display = 'none', 5000);

            if (warningCount >= MAX_WARNINGS) {
                examTerminated = true; // 🔧 LOCK SYSTEM
                alert('You have received 3 warnings. Exam will be submitted.');
                submitExam('violations');
            }
        });
}
