    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
    import { 
        getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, runTransaction 
    } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
    import { 
        getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, setPersistence, browserSessionPersistence
    } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

    const firebaseConfig = {
        apiKey: "AIzaSyDQDfsnKG6nuUu8q1pw15ZQnPs_vvJa0ls",
        authDomain: "meeting-system-ee93f.firebaseapp.com",
        projectId: "meeting-system-ee93f",
        storageBucket: "meeting-system-ee93f.firebasestorage.app",
        messagingSenderId: "875441850233",
        appId: "1:875441850233:web:318995771425a5a24f91a8",
        measurementId: "G-2QZ25EXVDZ"
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    
    // 管理員清單配置
    const ADMIN_EMAILS = ["m700912@gmail.com"];
    let currentUser = null;
    let calendar = null;

    const roomColors = {
        "A會議室": "#4285f4",
        "B會議室": "#34a853",
        "簡報室": "#fbbc05",
        "預設": "#9c27b0"
    };

    // 初始化 FullCalendar
    function initCalendar() {
        const calendarEl = document.getElementById('calendar');
        calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            locale: 'zh-tw',
            displayEventTime: false, // 隱藏日曆內建的時間標籤
            navLinks: true, 
            
            eventTimeFormat: {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            },

            eventDidMount: function(info) {
                info.el.style.whiteSpace = 'normal'; // 允許換行，確保長字完整呈現
                info.el.style.contentVisibility = 'auto';
                
                // ✨【動態 CSS 變數綁定】將該會議室的顏色塞到 CSS 變數中，左側就會變色
                const color = info.event.backgroundColor;
                info.el.style.setProperty('--event-bg-color', color);
            },
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                // right: 'dayGridMonth,timeGridWeek,timeGridDay'
                right: ''
            },
            buttonText: { today: '今天', month: '月', week: '週', day: '日' },
            datesSet: function(info) {
                updateMinguoTitle(info.view.title);
            },
            eventClick: function(info) {
                const props = info.event.extendedProps;
                
                // 時間格式轉換函式 (月/日 時:分)
                const toMinguoMsg = (dateStr) => {
                    if (!dateStr) return "未設定";
                    const d = new Date(dateStr);
                    const mm = d.getMonth() + 1;                  
                    const dd = d.getDate();                        
                    const hh = String(d.getHours()).padStart(2, '0');  
                    const min = String(d.getMinutes()).padStart(2, '0');
                    return `${mm}/${dd} ${hh}:${min}`;
                };

                // 🛠️【Bug 1 修復】直接抓取資料來源中的 originTitle，不再用 split 分割字串抓錯標題
                let msg = `會議：${props.originTitle}\n`;
                msg += `會議室：${props.room}\n`;
                msg += `科室：${props.dept || "未填"}\n`;
                msg += `預約者：${props.userName || "未填"}\n`;
                msg += `開始時間：${toMinguoMsg(props.startTime)}\n`;
                msg += `結束時間：${toMinguoMsg(props.endTime)}`;
                
                // 🔒 權限動態檢查
                const isOwner = currentUser && props.userEmail === currentUser.email;
                const isAdmin = currentUser && ADMIN_EMAILS.includes(currentUser.email);
                
                // 計算該會議是否為「一個月前」的舊資料 (以會議結束時間判斷)
                const oneMonthAgo = new Date();
                oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
                const isOneMonthAgoData = new Date(props.endTime) < oneMonthAgo;

                // 判斷是否符合刪除資格
                if (isOwner) {
                    // 條件 1：如果是建立者本人，隨時可刪除
                    if (confirm(`${msg}\n\n[您是此預約建立者] 確定要刪除此預約嗎？`)) {
                        delMeeting(info.event.id);
                    }
                } else if (isAdmin && isOneMonthAgoData) {
                    // 條件 2：如果是管理員，且該資料已經是「一個月前」的舊資料，允許刪除
                    if (confirm(`${msg}\n\n[您是管理員，此為一個月前舊資料] 確定要手動強制刪除此歷史預約嗎？`)) {
                        delMeeting(info.event.id);
                    }
                } else if (isAdmin && !isOneMonthAgoData) {
                    // 提示 3：管理員點擊非本人的近期會議 -> 阻擋
                    alert(`${msg}\n\n🔒 權限限制：管理員對非本人的近期會議僅有唯讀權限，只能刪除「一個月前」的舊資料。`);
                } else {
                    // 提示 4：一般人點擊非本人的會議 -> 阻擋
                    alert(`${msg}\n\n🔒 唯讀模式：您不是此會議的預約者，無法刪除他人的會議。`);
                }
            }
        });
        calendar.render();
    }

    function updateMinguoTitle(viewTitle) {
        const yearMatch = viewTitle.match(/\d{4}/);
        if (yearMatch) {
            const currentYear = parseInt(yearMatch[0]);
            const minguoYear = currentYear - 1911;
            document.getElementById("minguoDisplay").innerText = `💡 目前檢視：民國 ${minguoYear} 年 (${viewTitle})`;
        } else {
            document.getElementById("minguoDisplay").innerText = `💡 目前檢視：${viewTitle}`;
        }
    }

    // 監聽登入狀態
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            document.getElementById("userInfo").innerText = "✅已使用Google帳號登入";
            document.getElementById("userInfo").style.display = "block";
            document.getElementById("loginBtn").style.display = "none";
            
            // 如果是管理員，自動秀出「清理一個月前舊資料」按鈕
            if (ADMIN_EMAILS.includes(user.email)) {
                document.getElementById("cleanupBtn").style.display = "inline-block";
            }

            initCalendar(); 
            loadRooms();
            loadData();
        } else {
            document.getElementById("calendar").innerHTML = "";
            document.getElementById("minguoDisplay").innerText = "請先登入以查看預約行事曆";
            document.getElementById("cleanupBtn").style.display = "none";
        }
    });

    // 登入功能
    window.login = async function () {
        try {
            await setPersistence(auth, browserSessionPersistence);
            await signInWithPopup(auth, provider);
        } catch (e) {
            if (e.code === "auth/popup-blocked") {
                alert("❌ 登入視窗被瀏覽器攔截，請允許彈出視窗。");
            } else {
                alert("登入失敗：" + e.message);
            }
        }
    };

    // 載入會議室清單並預選 A 會議室
    async function loadRooms() {
        const snapshot = await getDocs(collection(db, "rooms"));
        const select = document.getElementById("room");
        select.innerHTML = ""; 
        snapshot.forEach((d) => {
            const roomName = d.data().name;
            const opt = document.createElement("option");
            opt.value = roomName;
            opt.textContent = roomName;
            if (roomName === "A會議室") opt.selected = true; 
            select.appendChild(opt);
        });
    }

    /* ➕ 新增預約 */
    window.addMeeting = async function () {
        if (!currentUser) return alert("請先登入");

        const title = document.getElementById("title").value;
        const dept = document.getElementById("dept").value;
        const userName = document.getElementById("userName").value;
        const room = document.getElementById("room").value;
        const startVal = document.getElementById("start").value;
        const endVal = document.getElementById("end").value;
        const addBtn = document.getElementById("addBtn");

        if (!title || !dept || !userName || !room || !startVal || !endVal) return alert("請填寫所有欄位");

        const newStart = new Date(startVal);
        const newEnd = new Date(endVal);
        if (newStart >= newEnd) return alert("❌ 結束時間必須晚於開始時間");

        addBtn.disabled = true;
        addBtn.textContent = "⌛ 正在同步核對預約...";

        try {
            await runTransaction(db, async (transaction) => {
                const snapshot = await getDocs(collection(db, "meetings"));
                let isConflict = false;

                snapshot.forEach((d) => {
                    const m = d.data();
                    if (m.room === room) {
                        const existS = new Date(m.startTime);
                        const existE = new Date(m.endTime);
                        if (newStart < existE && newEnd > existS) isConflict = true;
                    }
                });

                if (isConflict) throw "CONFLICT";

                const newDocRef = doc(collection(db, "meetings"));
                transaction.set(newDocRef, {
                    title, dept, userName, room,
                    startTime: startVal,
                    endTime: endVal,
                    userEmail: currentUser.email,
                    createdAt: new Date().toISOString()
                });
            });

            alert("✅ 預約成功！");
           // ✨【欄位自動清空】預約成功後，將所有輸入欄位恢復成空白或預設值
          // ✨ 修正後的欄位自動清空（直接對齊您原本的 HTML 欄位 ID）
            document.getElementById("title").value = "";
            document.getElementById("dept").value = "";
            document.getElementById("userName").value = "";
            document.getElementById("start").value = "";
            document.getElementById("end").value = "";
            document.getElementById("room").selectedIndex = 0; // 恢復成選單第一個
            loadData();
        } catch (e) {
            if (e === "CONFLICT") alert("❌ 該時段已被預約！");
            else alert("錯誤：" + e);
        } finally {
            addBtn.disabled = false;
            addBtn.textContent = "確認預約";
        }
    };

    // 刪除會議功能
    async function delMeeting(id) {
        await deleteDoc(doc(db, "meetings", id));
        loadData();
    }

    /* 🧹 管理員一鍵清理一個月前舊資料 */
    window.autoCleanup = async function () {
        if (!currentUser || !ADMIN_EMAILS.includes(currentUser.email)) {
            return alert("🔒 只有管理員可以使用此功能。");
        }

        if (confirm("確定要刪除所有「一個月前」的歷史會議預約資料嗎？此操作無法還原。")) {
            try {
                const snapshot = await getDocs(collection(db, "meetings"));
                const oneMonthAgo = new Date();
                oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1); 
                
                let deleteCount = 0;

                for (const d of snapshot.docs) {
                    const m = d.data();
                    const meetingEndTime = new Date(m.endTime);
                    
                    if (meetingEndTime < oneMonthAgo) {
                        await deleteDoc(doc(db, "meetings", d.id));
                        deleteCount++;
                    }
                }

                alert(`🧹 清理完成！共刪除了 ${deleteCount} 筆舊資料。`);
                loadData(); 
            } catch (e) {
                alert("清理失敗：" + e);
            }
        }
    };

    /* 📋 載入資料並放入行事曆 */
    async function loadData() {
        if (!calendar) return;
        
        try {
            const snapshot = await getDocs(collection(db, "meetings"));
            const events = [];

            snapshot.forEach((d) => {
                const m = d.data();
                const eventColor = roomColors[m.room] || roomColors["預設"];

                events.push({
                    id: d.id,
                    title: `📝 ${m.title}\n 📍 [${m.room}]\n 👤 ${m.userName}`,
                    start: m.startTime,
                    end: m.endTime,
                    backgroundColor: eventColor,
                    borderColor: eventColor,
                    extendedProps: {
                        originTitle: m.title,
                        room: m.room,
                        dept: m.dept,
                        userName: m.userName,
                        userEmail: m.userEmail,
                        startTime: m.startTime, 
                        endTime: m.endTime
                    }
                });
            });

            calendar.removeAllEvents();
            calendar.addEventSource(events);
            
        } catch (e) { 
            console.error("載入日曆資料失敗：", e); 
        }
    }
