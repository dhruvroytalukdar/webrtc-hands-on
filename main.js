import "./style.css";

import firebase from "firebase/app";
import "firebase/firestore";

import creds from "./creds";

if (!firebase.apps.length) {
  firebase.initializeApp(creds);
}
const firestore = firebase.firestore();

const servers = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
const pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = null;
let roomId;

// HTML elements
const webcamButton = document.getElementById("webcamButton");
const webcamVideo = document.getElementById("webcamVideo");
const callButton = document.getElementById("callButton");
const callInput = document.getElementById("callInput");
const modalButton = document.getElementById("modalButton");
const remoteVideo = document.getElementById("remoteVideo");
const hangupButton = document.getElementById("hangupButton");
const answerButton = document.getElementById("answerButton");
const roomCode = document.getElementById("roomCode");

// 1. Setup media sources
webcamButton.onclick = async () => {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
  remoteStream = new MediaStream();

  // Push tracks from local stream to peer connection
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // Pull tracks from remote stream, add to video stream
  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
  };

  webcamVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;

  callButton.disabled = false;
  modalButton.disabled = false;
  webcamButton.disabled = true;
};

roomCode.onclick = () => {
  var dummy = document.createElement("input");
  document.body.appendChild(dummy);
  dummy.setAttribute("id", "dummy_id");
  document.getElementById("dummy_id").value = roomId;
  dummy.select();
  dummy.setSelectionRange(0, 99999);
  navigator.clipboard.writeText(roomId);
  const copyToast = document.getElementById("notification");
  document.querySelector("#message").textContent =
    "Room ID copied to clipboard";
  const toast = new bootstrap.Toast(copyToast);
  toast.show();
  document.body.removeChild(dummy);
};

// 2. Create an offer
callButton.onclick = async () => {
  // Reference Firestore collections for signaling
  const callDoc = firestore.collection("calls").doc();
  const offerCandidates = callDoc.collection("offerCandidates");
  const answerCandidates = callDoc.collection("answerCandidates");

  // Get candidates for caller, save to db
  pc.onicecandidate = (event) => {
    event.candidate && offerCandidates.add(event.candidate.toJSON());
  };

  // Create offer
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  await callDoc.set({ offer });

  // Listen for remote answer
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
  });

  // When answered, add candidate to peer connection
  answerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });

  hangupButton.disabled = false;
  modalButton.disabled = true;
  callButton.disabled = true;
  roomCode.textContent = `Room Code: ${callDoc.id}`;
  roomId = callDoc.id;
};

// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
  const callId = callInput.value;
  roomId = callId;
  if (callId.length === 0) return;
  roomCode.textContent = `Room Code: ${callId}`;
  const callDoc = firestore.collection("calls").doc(callId);
  const answerCandidates = callDoc.collection("answerCandidates");
  const offerCandidates = callDoc.collection("offerCandidates");

  pc.onicecandidate = (event) => {
    event.candidate && answerCandidates.add(event.candidate.toJSON());
  };

  const callData = (await callDoc.get()).data();

  const offerDescription = callData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  await callDoc.update({ answer });

  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        let data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });

  hangupButton.disabled = false;
  modalButton.disabled = true;
  callButton.disabled = true;
};

hangupButton.onclick = async () => {
  const tracks = document.querySelector("#webcamVideo").srcObject.getTracks();
  tracks.forEach((track) => {
    track.stop();
  });

  if (remoteStream) remoteStream.getTracks().forEach((track) => track.stop());

  if (pc) pc.close();

  callButton.disabled = true;
  modalButton.disabled = true;
  hangupButton.disabled = true;
  webcamButton.disabled = false;

  let roomId = callInput.value;
  if (roomId) {
    const db = firebase.firestore();
    const roomRef = db.collection("calls").doc(roomId);
    await roomRef.delete();
  }

  callInput.value = "";
  roomId = null;
  roomCode.textContent = "";
  document.location.reload(true);
};
