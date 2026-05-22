import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
    import { 
        getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, runTransaction, writeBatch 
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
    
    // 💡 資安優化：前端不宣告任何管理員 Email 名單，全權交由後端 Rules 鐵壁控管
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
            initialView: 'dayGridMonth', // 只留月檢視
            locale: 'zh-tw',
            displayEventTime: false,     // 隱藏日曆內建的時間標籤
            navLinks: false,             // 關閉點擊日期切換到天檢視的功能
            
            eventTimeFormat: {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            },

            eventDidMount: function(info) {
                info.el.style.whiteSpace = 'normal'; // 允許換行，確保長字完整呈現
                info.el.style.contentVisibility = 'auto';
                
                // 【動態 CSS 變數綁定】將該會議室的顏色塞到 CSS 變數中
                const color = info.event.backgroundColor;
                info.el.style.setProperty('--event-bg-color', color);
            },
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: ''
            },
            buttonText: { today: '今天' },
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

                // 直接抓取資料來源中的 originTitle，避免切割字串出錯
                let msg = `會議：${props.originTitle}\n`;
                msg += `會議室：${props.room}\n`;
                msg += `科室：${props.dept || "未填"}\n`;
                msg += `預約者：${props.userName || "未填"}\n`;
                msg += `開始時間：${toMinguoMsg(props.startTime)}\n`;
                msg += `結束時間：${toMinguoMsg(props.endTime)}`;
                
                // 檢查是否為建立者本人
                const isOwner = currentUser && props.userEmail === currentUser.email;

                // 判斷是否符合刪除資格
                if (isOwner) {
                    // 狀況 1：如果是建立者本人，隨時可刪除
                    if (confirm(`${msg}\n\n[是此預約建立者] 確定要刪除此預約嗎？`)) {
                        delMeeting(info.event.id);
                    }
                } else {
                    // 狀況 2：非本人建立的行程（交給後端 Rules 去卡管理員或一般人身份）
                   alert(`${msg}\n\n❌ 系統提示：並非此預約建立者，無權刪除此行程。`);
                }
            }
        });
        calendar.render();
    }

    // 更新民國年標題
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
            document.getElementById("userInfo").innerText = "✅ 已使用 Google 帳號登入";
            document.getElementById("userInfo").style.display = "block";
            document.getElementById("loginBtn").style.display = "none";
            
            // 資安優化：只要登入成功一律顯示清理按鈕，實質權限交由後端 Rules 驗證
            document.getElementById("cleanupBtn").style.display = "inline-block";

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
                alert("❌ 登入失敗：請確認網路連線或嘗試重新登入。");
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
        
        // 💡 補強：避免無效的時間造成比對崩潰
        if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) return alert("❌ 請填寫正確的時間格式");
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
            document.getElementById("title").value = "";
            document.getElementById("dept").value = "";
            document.getElementById("userName").value = "";
            document.getElementById("start").value = "";
            document.getElementById("end").value = "";
            document.getElementById("room").selectedIndex = 0; 
            loadData();
        } catch (e) {
            if (e === "CONFLICT") alert("❌ 該時段已被預約！");
            else alert("❌ 預約失敗：系統寫入發生錯誤，請稍後再試。");
        } finally {
            addBtn.disabled = false;
            addBtn.textContent = "確認預約";
        }
    };

    // 刪除個別會議功能
    async function delMeeting(id) {
        try {
            await deleteDoc(doc(db, "meetings", id));
            loadData();
        } catch (error) {
            if (error.code === 'permission-denied') {
                alert("🔒並非此預約建立者，無權刪除此行程。");
            } else {
                console.error("刪除失敗技術詳情：", error); // 💡 保留 Log 供工程師看 F12
                alert("❌ 刪除失敗請洽工程師。");
            }
        }
    }

    /* 🧹 管理員一鍵清理 */
    window.autoCleanup = async function () {
        if (!currentUser) return alert("請先登入");

        if (confirm("確定要自動清理所有「一個月前」的歷史會議預約嗎？")) {
            const cleanupBtn = document.getElementById('cleanupBtn');
            if (cleanupBtn) {
                cleanupBtn.disabled = true;
                cleanupBtn.innerText = "舊資料清理中...";
            }

            try {
                const snapshot = await getDocs(collection(db, "meetings"));
                
                const oneMonthAgo = new Date();
                oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1); 
                
                const batch = writeBatch(db);
                let deleteCount = 0;

                snapshot.forEach((d) => {
                    const m = d.data();
                    const meetingEndTime = new Date(m.endTime);
                    
                    if (meetingEndTime < oneMonthAgo) {
                        batch.delete(d.ref);
                        deleteCount++;
                    }
                });

                if (deleteCount === 0) {
                    alert("✨ 檢查完畢！目前行事曆中沒有一個月前的舊資料，無需清理。");
                    // 💡 補強：在直回傳前，必須要把按鈕解凍，不然同仁無法再點擊
                    if (cleanupBtn) {
                        cleanupBtn.disabled = false;
                        cleanupBtn.innerText = "🧹 清理一個月前舊資料";
                    }
                    return;
                }

                // 🚀 送交後端
                await batch.commit();

                alert(`🧹 清理完成！共成功刪除了 ${deleteCount} 筆一個月前的舊歷史資料。`);
                loadData(); 
                
            } catch (e) {
                console.error("清理失敗技術詳情：", e); // 💡 修正：傳入 e 才能保留系統真實報錯
                
                if (e.code === 'permission-denied') {
                    alert("🔒 非管理者無法執行清理一個月前資料。");
                } else {
                    alert("❌ 清理失敗請洽工程師");
                }
            } finally {
                if (cleanupBtn) {
                    cleanupBtn.disabled = false;
                    cleanupBtn.innerText = "🧹 清理一個月前舊資料";
                }
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
