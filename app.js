// ================= SETUP =================
const { createClient } = supabase;
const db = createClient(
  "https://bglkwkudbbouockxbhcq.supabase.co",
  "sb_publishable_G-xjJM3MNpr4YTVsQrVwfA_sPOj_tV3"
);

// The room names must match what is stored in the database
const ROOMS = [
  { name: "Living Room", icon: "🛋️" },
  { name: "Kitchen",     icon: "🍳" },
  { name: "Bathroom",    icon: "🛁" },
  { name: "Bedroom",     icon: "🛏️" },
  { name: "Balcony",     icon: "🪴" }
];

// ================= STATE =================
let chores = [];
let profiles = [];
let onlineUserIds = new Set(); // Tracks IDs of currently online family members
let presenceChannel = null;
let myRole = "member";
let myId = null;
let filter = "all";

const roomsDiv = document.getElementById("rooms");

// Fill the room dropdown from the ROOMS list
const roomSelect = document.getElementById("room");
ROOMS.forEach(r => {
  const option = document.createElement("option");
  option.value = r.name;
  option.textContent = r.icon + " " + r.name;
  roomSelect.appendChild(option);
});

// ================= HELPERS =================
function showStatus(message) {
  const el = document.getElementById("status");
  el.textContent = message;
  el.hidden = !message;
}

function profileName(id) {
  const p = profiles.find(p => p.id === id);
  return p ? p.display_name : null;
}

function makeAvatar(name, url) {
  if (url) {
    const img = document.createElement("img");
    img.className = "avatar";
    img.src = url;
    img.alt = name;
    return img;
  }
  const el = document.createElement("span");
  el.className = "avatar";
  el.textContent = (name || "?").charAt(0).toUpperCase();
  let hue = 0;
  for (const ch of (name || "?")) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  el.style.background = "hsl(" + hue + " 65% 42%)";
  return el;
}

function renderHeader() {
  const me = profiles.find(p => p.id === myId);
  const slot = document.getElementById("user-avatar");
  slot.innerHTML = "";
  slot.appendChild(makeAvatar(me ? me.display_name : "?", me ? me.avatar_url : null));
  document.getElementById("user-name").textContent = me ? me.display_name : "";
}

function renderOnlineUsers() {
  const bar = document.getElementById("online-bar");
  const list = document.getElementById("online-users");
  list.innerHTML = "";

  // Match online IDs against loaded profiles
  const onlineMembers = profiles.filter(p => onlineUserIds.has(p.id));
  bar.hidden = onlineMembers.length === 0;

  onlineMembers.forEach(member => {
    const pill = document.createElement("span");
    pill.className = "online-pill";

    const dot = document.createElement("span");
    dot.className = "online-dot";

    const label = document.createElement("span");
    label.textContent = member.display_name + (member.id === myId ? " (you)" : "");

    pill.appendChild(dot);
    pill.appendChild(label);
    list.appendChild(pill);
  });
}

function renderFamily() {
  const box = document.getElementById("family-list");
  box.innerHTML = "";

  const stats = profiles.map(p => {
    const mine = chores.filter(c => c.assigned_to === p.id);
    const done = mine.filter(c => c.done).length;
    return {
      profile: p,
      total: mine.length,
      done: done,
      pct: mine.length ? Math.round((done / mine.length) * 100) : 0
    };
  });

  stats.sort((a, b) => b.done - a.done || b.pct - a.pct);

  stats.forEach((s, i) => {
    const card = document.createElement("div");
    card.className = "card member";

    const head = document.createElement("div");
    head.className = "member-head";

    // Wrap avatar so we can place a green online badge if they are active
    const avatarWrap = document.createElement("div");
    avatarWrap.className = "avatar-wrap";
    const avatar = makeAvatar(s.profile.display_name, s.profile.avatar_url);
    avatar.classList.add("big");
    avatarWrap.appendChild(avatar);

    if (onlineUserIds.has(s.profile.id)) {
      const dot = document.createElement("span");
      dot.className = "status-dot";
      dot.title = "Online now";
      avatarWrap.appendChild(dot);
    }

    const name = document.createElement("span");
    name.className = "name";
    const medal = (i === 0 && s.done > 0) ? "🥇 " : "";
    name.textContent = medal + s.profile.display_name + (s.profile.id === myId ? " (you)" : "");

    const score = document.createElement("span");
    score.className = "score";
    score.textContent = s.done + " / " + s.total + " done";

    head.appendChild(avatarWrap);
    head.appendChild(name);
    head.appendChild(score);
    card.appendChild(head);

    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("div");
    fill.className = "fill";
    fill.style.width = s.pct + "%";
    bar.appendChild(fill);
    card.appendChild(bar);

    const pct = document.createElement("div");
    pct.className = "pct";
    pct.textContent = s.total ? s.pct + "%" : "Nothing assigned yet";
    card.appendChild(pct);

    box.appendChild(card);
  });

  const unclaimed = chores.filter(c => !c.assigned_to && !c.done).length;
  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = unclaimed + " unassigned chore" + (unclaimed === 1 ? "" : "s") + " waiting for someone.";
  box.appendChild(note);
}

// ================= TABS + FILTER =================
function showTab(name) {
  ["chores", "items", "cat", "family"].forEach(t => {
    document.getElementById("tab-" + t).hidden = (t !== name);
  });
  document.querySelectorAll(".tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
}

function setFilter(value) {
  filter = value;
  document.getElementById("filter-all").classList.toggle("active", value === "all");
  document.getElementById("filter-mine").classList.toggle("active", value === "mine");
  render();
}

// ================= LOAD DATA =================
async function loadMyRole(userId) {
  const { data, error } = await db
    .from("profiles").select("role").eq("id", userId).single();
  if (error) {
    console.error(error);
    showStatus("Could not load your role: " + error.message);
    return;
  }
  myRole = data.role;
  document.getElementById("role-badge").textContent = myRole;
  document.getElementById("admin-panel").hidden = (myRole !== "admin");
}

async function loadProfiles() {
  const { data, error } = await db.from("profiles").select("id, display_name, avatar_url");
  if (error) { console.error(error); showStatus("Could not load members: " + error.message); return; }
  profiles = data;

  const sel = document.getElementById("assignee");
  sel.innerHTML = '<option value="">Anyone</option>';
  profiles.forEach(p => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.display_name;
    sel.appendChild(o);
  });
}

async function loadChores() {
  const { data, error } = await db.from("chores").select("*").order("id");
  if (error) { console.error(error); showStatus("Could not load chores: " + error.message); return; }
  chores = data;
  render();
}

// ================= ACTIONS =================
async function addChore(event) {
  if (event) event.preventDefault();
  const input = document.getElementById("chore");
  const room = document.getElementById("room");
  const assignee = document.getElementById("assignee");
  const choreText = input.value.trim();
  if (choreText === "") return;

  const isDuplicate = chores.some(c =>
    c.room === room.value &&
    c.text.trim().toLowerCase() === choreText.toLowerCase()
  );
  if (isDuplicate) {
    alert('"' + choreText + '" is already in ' + room.value + "!");
    return;
  }

  const { error } = await db.from("chores").insert({
    text: choreText,
    room: room.value,
    assigned_to: assignee.value || null,
    assigned_by: myId
  });
  if (error) { console.error(error); alert(error.message); return; }

  input.value = "";
  loadChores();
}

async function toggleChore(id) {
  const chore = chores.find(c => c.id === id);
  if (!chore) return;
  const { error } = await db.from("chores").update({ done: !chore.done }).eq("id", id);
  if (error) { console.error(error); alert(error.message); return; }
  loadChores();
}

async function deleteChore(id) {
  if (!confirm("Delete this chore?")) return;
  const { error } = await db.from("chores").delete().eq("id", id);
  if (error) { console.error(error); alert(error.message); return; }
  loadChores();
}

async function createMember() {
  const username = document.getElementById("new-username").value;
  const password = document.getElementById("new-password").value;

  const { error } = await db.functions.invoke("create-member", {
    body: { username, password }
  });
  if (error) {
    let msg = error.message;
    try {
      const body = await error.context.json();
      msg = body.error || body.message || msg;
    } catch (e) {}
    alert(msg);
    return;
  }

  alert("Created " + username);
  document.getElementById("new-username").value = "";
  document.getElementById("new-password").value = "";
  await loadProfiles();
  render();
}

async function uploadAvatar(input) {
  const file = input.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) { alert("Please choose an image."); return; }
  if (file.size > 2 * 1024 * 1024) { alert("Image must be under 2 MB."); return; }

  const path = myId + "/avatar";
  const { error: uploadError } = await db.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) { alert(uploadError.message); return; }

  const { data } = db.storage.from("avatars").getPublicUrl(path);
  const url = data.publicUrl + "?v=" + Date.now();

  const { error } = await db.from("profiles").update({ avatar_url: url }).eq("id", myId);
  if (error) { alert(error.message); return; }

  input.value = "";
  await loadProfiles();
  renderHeader();
  renderOnlineUsers();
  render();
}

// ================= DRAW THE PAGE =================
function render() {
  roomsDiv.innerHTML = "";

  const total = chores.length;
  const totalDone = chores.filter(c => c.done).length;
  document.getElementById("summary-text").textContent = totalDone + " of " + total + " done";
  document.getElementById("summary-fill").style.width = (total ? (totalDone / total) * 100 : 0) + "%";

  ROOMS.forEach(room => {
    const roomChores = chores.filter(c => c.room === room.name);
    const doneCount = roomChores.filter(c => c.done).length;
    const isComplete = roomChores.length > 0 && doneCount === roomChores.length;

    const visible = roomChores.filter(c => filter === "all" || c.assigned_to === myId);

    const card = document.createElement("div");
    card.className = "card room" + (isComplete ? " complete" : "");

    const head = document.createElement("div");
    head.className = "room-head";
    const title = document.createElement("h2");
    title.textContent = room.icon + " " + room.name;
    const count = document.createElement("span");
    count.className = "room-count";
    count.textContent = doneCount + "/" + roomChores.length;
    head.appendChild(title);
    head.appendChild(count);
    card.appendChild(head);

    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("div");
    fill.className = "fill";
    fill.style.width = (roomChores.length ? (doneCount / roomChores.length) * 100 : 0) + "%";
    bar.appendChild(fill);
    card.appendChild(bar);

    const ul = document.createElement("ul");
    ul.className = "chore-list";

    visible.forEach(chore => {
      const li = document.createElement("li");
      li.className = "chore" + (chore.done ? " done" : "");
      li.onclick = () => toggleChore(chore.id);

      const check = document.createElement("span");
      check.className = "check";
      check.textContent = chore.done ? "✓" : "";

      const text = document.createElement("span");
      text.className = "chore-text";
      text.textContent = chore.text;

      const who = document.createElement("span");
      who.className = "assignee assignee-wrap";
  
      const assignedName = profileName(chore.assigned_to);
      const assignedByName = profileName(chore.assigned_by);
  
      if (assignedName) {
        const person = profiles.find(p => p.id === chore.assigned_to);
        who.appendChild(makeAvatar(assignedName, person ? person.avatar_url : null));
        const label = document.createElement("span");
        label.textContent = assignedName;
        who.appendChild(label);
      } else {
        who.textContent = "Anyone";
      }

    // Creates the hover tooltip element
    const tooltip = document.createElement("span");
    tooltip.className = "assignee-tooltip";
    tooltip.textContent = assignedByName ? "Assigned by " + assignedByName : "Self-assigned / Unassigned";
    who.appendChild(tooltip);

      li.appendChild(check);
      li.appendChild(text);
      li.appendChild(who);

      if (myRole === "admin") {
        const del = document.createElement("button");
        del.className = "delete-btn";
        del.textContent = "✕";
        del.onclick = (event) => {
          event.stopPropagation();
          deleteChore(chore.id);
        };
        li.appendChild(del);
      }

      ul.appendChild(li);
    });

    card.appendChild(ul);

    if (visible.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = filter === "mine" ? "Nothing assigned to you here." : "No chores yet.";
      card.appendChild(empty);
    }

    if (isComplete) {
      const msg = document.createElement("p");
      msg.className = "complete-msg";
      msg.textContent = "✨ All " + room.name + " chores done!";
      card.appendChild(msg);
    }

    roomsDiv.appendChild(card);
  });

  renderFamily();
}

// ================= ONLINE PRESENCE =================
function startPresence(userId) {
  if (presenceChannel) db.removeChannel(presenceChannel);

  presenceChannel = db.channel("house-presence", {
    config: { presence: { key: userId } }
  });

  presenceChannel
    .on("presence", { event: "sync" }, () => {
      const state = presenceChannel.presenceState();
      onlineUserIds = new Set(Object.keys(state));
      renderOnlineUsers();
      renderFamily();
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await presenceChannel.track({
          user_id: userId,
          online_at: new Date().toISOString()
        });
      }
    });
}

function stopPresence() {
  if (presenceChannel) {
    db.removeChannel(presenceChannel);
    presenceChannel = null;
  }
  onlineUserIds.clear();
  renderOnlineUsers();
}

// ================= SIGN IN / OUT =================
async function signIn() {
  let id = document.getElementById("email").value.trim().toLowerCase();
  if (!id.includes("@")) id = id + "@housequest.example";

  const { error } = await db.auth.signInWithPassword({
    email: id,
    password: document.getElementById("password").value
  });
  if (error) alert(error.message);
}

async function signOut() {
  stopPresence();
  await db.auth.signOut();
}

db.auth.onAuthStateChange((event, session) => {
  document.getElementById("auth").hidden = !!session;
  document.getElementById("app").hidden = !session;

  if (session) {
    myId = session.user.id;
    showStatus("");

    Promise.all([loadProfiles(), loadMyRole(session.user.id)]).then(() => {
      renderHeader();
      loadChores();
      startPresence(session.user.id);
    });
  } else {
    myId = null;
    myRole = "member";
    chores = [];
    stopPresence();
  }
});

// ================= LIVE UPDATES =================
db.channel("chores-changes")
  .on("postgres_changes",
      { event: "*", schema: "public", table: "chores" },
      () => loadChores())
  .subscribe();
