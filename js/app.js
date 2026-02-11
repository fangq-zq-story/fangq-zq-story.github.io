const APP_ID = '1bb3a23f54f31dadc50f15ce6608a9f5'; 
// ✅ 记得用你的 Secret Key
const REST_KEY = 'b5264160f632cf6751a59de9e3e966b1';
const BASE_URL = 'https://api.bmobcloud.com/1';
const PHOTO_TABLE = 'Photo';
const COMMENT_TABLE = 'Comment';
const IMGBB_KEY = '4a29896ebe2442bb3af8ac1e1e6e1453';

let isUserAdmin = false; let currentUser = null;
let displayedMessageIds = new Set(); 

let currentPhotoId = null;
let photoCommentInterval = null;
let danmakuLaneIndex = 0;
let danmakuQueue = []; 

function removeLoader() {
    const loader = document.getElementById('page-loader');
    if (loader && loader.style.display !== 'none') {
        loader.style.opacity = '0';
        setTimeout(() => {
            loader.style.display = 'none';
            AOS.init({ once: true, offset: 60 });
            checkLocalLogin(); loadCloudMessages(); loadCloudPhotos(); initTypewriter();
            initMusicPlayer();
            startDanmakuScheduler(); 
        }, 600);
    }
}

window.addEventListener('load', removeLoader);
setTimeout(removeLoader, 5000); 

// ✅✅✅ 核心修复：阻止事件冒泡 + 监听回车发送
const sidebarInput = document.getElementById('sidebar-input');
if(sidebarInput) {
    sidebarInput.addEventListener('keydown', (e) => { 
        e.stopPropagation(); // 防止按键触发 Fancybox 的快捷键
        if (e.key === 'Enter') {
            postSidebarComment(); // 回车直接发送
        }
    });
}

document.getElementById('photo-comment-sidebar').addEventListener('click', (e) => { e.stopPropagation(); });
document.getElementById('comment-toggle-btn').addEventListener('click', (e) => { e.stopPropagation(); });

function bmobRequest(endpoint, method, body=null) {
    const headers = { 'X-Bmob-Application-Id': APP_ID, 'X-Bmob-REST-API-Key': REST_KEY, 'Content-Type': 'application/json' };
    if(localStorage.getItem('bmob_session')) headers['X-Bmob-Session-Token'] = localStorage.getItem('bmob_session');
    const config = { method: method, headers: headers };
    if(body) config.body = JSON.stringify(body);
    return fetch(BASE_URL + endpoint, config).then(res => { 
        if(!res.ok) throw new Error(`${res.status} ${res.statusText}`); 
        return res.json(); 
    });
}

function toggleModal(id) {
    const modal = document.getElementById(id);
    if(id === 'login-modal' && currentUser) {
        if(confirm("确定退出登录吗？")) { localStorage.removeItem('bmob_user'); localStorage.removeItem('bmob_session'); location.reload(); }
    } else {
        modal.style.display = (modal.style.display === 'flex') ? 'none' : 'flex';
    }
}

function renderGalleryItem(photo, isPrepend = false) {
    if(!photo.url) return;
    let safeUrl = photo.url;
    if(safeUrl.indexOf('http') !== 0 && safeUrl.indexOf('/') !== 0) safeUrl = '/' + safeUrl;

    const gallery = document.getElementById('gallery-grid');
    const div = document.createElement('div'); 
    div.className = 'gallery-item'; 
    div.setAttribute('data-id', photo.objectId);
    div.setAttribute('data-order', photo.order || 0); 
    
    let controls = '';
    if(isUserAdmin) {
        controls = `<div class="photo-controls" onclick="event.stopPropagation()">
            <div class="control-btn btn-edit" onclick="openEditPhoto('${photo.objectId}', '${photo.caption}')">✎</div>
            <div class="control-btn btn-delete" onclick="deletePhoto('${photo.objectId}', this)">🗑️</div></div>`;
    }

    const isVideo = safeUrl.match(/\.(mp4|mov|webm|ogg)$/i);

    if (isVideo) {
        let thumbUrl = safeUrl;
        if(safeUrl.indexOf('#t=') === -1) thumbUrl += '#t=1.0';

        div.innerHTML = `${controls}
            <a href="${safeUrl}" data-fancybox="gallery" data-caption="${photo.caption}" data-id="${photo.objectId}">
                <div class="video-badge"></div>
                <video src="${thumbUrl}" muted preload="metadata" playsinline></video>
            </a>
            <div class="photo-caption-text">${photo.caption}</div>`;
    } else {
        div.innerHTML = `${controls}
            <a href="${safeUrl}" data-fancybox="gallery" data-caption="${photo.caption}" data-id="${photo.objectId}">
                <img src="${safeUrl}" alt="${photo.caption}" loading="lazy">
            </a>
            <div class="photo-caption-text">${photo.caption}</div>`;
    }

    if (isPrepend && gallery.firstChild) {
        gallery.insertBefore(div, gallery.firstChild);
    } else {
        gallery.appendChild(div);
    }
}

function uploadMedia() {
    const fileInput = document.getElementById('photo-file');
    const urlInput = document.getElementById('custom-url');
    const captionInput = document.getElementById('photo-caption');
    
    const file = fileInput.files[0];
    const urlVal = urlInput.value.trim();
    const caption = captionInput.value.trim() || "美好的瞬间";
    const btn = document.getElementById('upload-btn-action'); 

    if (urlVal) {
        btn.disabled = true; btn.innerText = "💾 正在保存链接..."; 
        bmobRequest(`/classes/${PHOTO_TABLE}`, 'POST', { url: urlVal, caption: caption, order: Date.now() })
        .then((res) => { 
            alert("✨ 链接添加成功！"); 
            toggleModal('upload-modal'); 
            renderGalleryItem({ objectId: res.objectId, url: urlVal, caption: caption, order: Date.now() }, true); 
            urlInput.value = ''; captionInput.value = ''; btn.disabled = false; btn.innerText = "☁️ 保存到云端";
        })
        .catch(e => { console.error(e); alert("保存失败: " + e.message); btn.disabled = false; btn.innerText = "☁️ 保存到云端"; });
        return;
    }

    if (file) {
        if (file.type.startsWith('video/')) {
            alert("⚠️ 视频文件请勿直接上传。\n\n请将视频放在项目 static/videos 文件夹里，然后粘贴链接（如 /videos/1.mp4）。");
            return;
        }
        btn.disabled = true; btn.innerText = "⏳ 正在上传图片..."; 
        const formData = new FormData();
        formData.append("image", file);
        fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, { method: "POST", body: formData })
        .then(res => res.json())
        .then(imgData => {
            if(!imgData.success) throw new Error("图床上传失败");
            btn.innerText = "💾 正在保存..."; 
            return bmobRequest(`/classes/${PHOTO_TABLE}`, 'POST', { url: imgData.data.url, caption: caption, order: Date.now() });
        })
        .then((res) => { 
            alert("✨ 图片上传成功！"); 
            toggleModal('upload-modal'); 
            renderGalleryItem({ objectId: res.objectId, url: imgData.data.url, caption: caption, order: Date.now() }, true);
            fileInput.value = ''; captionInput.value = ''; btn.disabled = false; btn.innerText = "☁️ 保存到云端";
        })
        .catch(e => { console.error(e); alert("上传失败: " + e.message); btn.disabled = false; btn.innerText = "☁️ 保存到云端"; });
        return;
    }
    alert("请选择图片文件，或者粘贴视频链接！");
}

function loadCloudPhotos() {
    bmobRequest(`/classes/${PHOTO_TABLE}?order=order,-createdAt&limit=500`, 'GET').then(data => {
        if(data.results && data.results.length > 0) {
            data.results.forEach(photo => { renderGalleryItem(photo, false); });
            
            // ✅✅✅ 核心修复：添加 autoFocus: false 等配置，允许在查看大图时输入评论
            Fancybox.bind("[data-fancybox]", { 
                Carousel: { infinite: true }, 
                Thumbs: { type: "classic" }, 
                Toolbar: { display: { right: ["close"] } },
                Html: { video: { autoplay: true } },
                // 👇 解除焦点锁定，让你能点输入框
                autoFocus: false,
                trapFocus: false,
                placeFocusBack: false,
                on: {
                    "Carousel.ready": (fancybox) => { 
                        const dmArea = document.getElementById('dm-input-area'); if(dmArea) dmArea.classList.add('hide-input'); 
                        const slide = fancybox.getSlide(); if(slide && slide.triggerEl) showPhotoSidebar(slide.triggerEl.dataset.id);
                    },
                    "Carousel.change": (fancybox) => {
                        const currentSlide = fancybox.getSlide();
                        if(currentSlide && currentSlide.triggerEl) {
                            const pid = currentSlide.triggerEl.dataset.id;
                            if(pid !== currentPhotoId) { document.getElementById('sidebar-input').value = ''; updateSidebarContent(pid); }
                        }
                    },
                    "close": () => { 
                        const dmArea = document.getElementById('dm-input-area'); if(dmArea) dmArea.classList.remove('hide-input'); 
                        closeSidebarCompletely(); 
                    }
                }
            });
        }
    });
}

function showPhotoSidebar(pid) {
    currentPhotoId = pid;
    const sidebar = document.getElementById('photo-comment-sidebar');
    const toggleBtn = document.getElementById('comment-toggle-btn');
    sidebar.classList.add('show');
    toggleBtn.style.display = 'none'; 
    loadPhotoComments(pid);
    startSidebarPolling();
}

function updateSidebarContent(pid) {
    currentPhotoId = pid;
    document.getElementById('sidebar-comment-list').innerHTML = '<div style="text-align:center; color:#999; margin-top:20px;">加载中...</div>';
    loadPhotoComments(pid);
}

function closeSidebarManually() {
    document.getElementById('photo-comment-sidebar').classList.remove('show');
    document.getElementById('comment-toggle-btn').style.display = 'flex';
}

function openSidebarManually() {
    document.getElementById('photo-comment-sidebar').classList.add('show');
    document.getElementById('comment-toggle-btn').style.display = 'none';
}

function closeSidebarCompletely() {
    document.getElementById('photo-comment-sidebar').classList.remove('show');
    document.getElementById('comment-toggle-btn').style.display = 'none';
    currentPhotoId = null;
    if(photoCommentInterval) clearInterval(photoCommentInterval);
}

function startSidebarPolling() {
    if(photoCommentInterval) clearInterval(photoCommentInterval);
    photoCommentInterval = setInterval(() => {
        if(currentPhotoId) loadPhotoComments(currentPhotoId);
    }, 4000);
}

function loadPhotoComments(pid) {
    const where = JSON.stringify({ "photoId": pid });
    bmobRequest(`/classes/${COMMENT_TABLE}?where=${encodeURIComponent(where)}&order=-createdAt`, 'GET').then(data => {
        const list = document.getElementById('sidebar-comment-list');
        if(!data.results || data.results.length === 0) {
            if(list.children.length === 0 || list.innerText.includes('加载中')) list.innerHTML = '<div style="text-align:center; color:#999; margin-top:20px;">还没有评论，快来抢沙发~</div>';
            if(list.children.length > 0 && !list.innerText.includes('没有评论')) list.innerHTML = '<div style="text-align:center; color:#999; margin-top:20px;">还没有评论，快来抢沙发~</div>';
            return;
        }
        if(list.innerText.includes('加载中') || list.innerText.includes('还没有评论')) list.innerHTML = '';
        const existingIds = Array.from(list.children).map(el => el.getAttribute('data-cid')).filter(id => id);
        const newComments = data.results;
        for(let i = newComments.length - 1; i >= 0; i--) {
            const comment = newComments[i];
            if(!existingIds.includes(comment.objectId)) {
                const div = createCommentElement(comment);
                list.prepend(div);
            }
        }
        const newIds = newComments.map(c => c.objectId);
        Array.from(list.children).forEach(child => {
            const cid = child.getAttribute('data-cid');
            if(cid && !newIds.includes(cid)) child.remove();
        });
    });
}

function createCommentElement(comment) {
    const div = document.createElement('div');
    div.className = 'sidebar-comment-item';
    div.setAttribute('data-cid', comment.objectId); 
    let delBtn = isUserAdmin ? `<div class="sidebar-del-btn show-admin" onclick="deletePhotoComment('${comment.objectId}')">×</div>` : '';
    div.innerHTML = `${delBtn}<div class="sidebar-comment-content">${comment.content}</div><div class="sidebar-comment-time">${comment.createdAt.split(' ')[0]}</div>`;
    return div;
}

function postSidebarComment() {
    const input = document.getElementById('sidebar-input');
    const val = input.value.trim();
    if(!val) return;
    if(!currentPhotoId) return;
    const btn = document.getElementById('sidebar-btn');
    btn.disabled = true; btn.innerText = '...';
    bmobRequest(`/classes/${COMMENT_TABLE}`, 'POST', { content: val, photoId: currentPhotoId }).then(() => {
        input.value = '';
        btn.disabled = false; btn.innerText = '发送';
        input.focus(); 
        loadPhotoComments(currentPhotoId); 
    }).catch(() => {
        btn.disabled = false; btn.innerText = '重试';
    });
}

window.deletePhotoComment = function(cid) {
    if(!confirm("删掉这条评论？")) return;
    bmobRequest(`/classes/${COMMENT_TABLE}/${cid}`, 'DELETE').then(() => {
        if(currentPhotoId) loadPhotoComments(currentPhotoId);
    });
}

function initAdminDrag() {
    const grid = document.getElementById('gallery-grid');
    new Sortable(grid, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: function (evt) {
            const items = grid.querySelectorAll('.gallery-item');
            const updates = [];
            items.forEach((item, index) => {
                const objectId = item.getAttribute('data-id');
                const newOrder = (index + 1) * 1000; 
                updates.push({ "method": "PUT", "path": `/1/classes/${PHOTO_TABLE}/${objectId}`, "body": { "order": newOrder } });
            });
            const promises = updates.map(req => bmobRequest(`/classes/${PHOTO_TABLE}/${req.path.split('/').pop()}`, 'PUT', req.body));
            Promise.all(promises).then(() => { console.log("顺序保存成功"); });
        }
    });
}

function openEditPhoto(id, oldCaption) {
    document.getElementById('edit-photo-id').value = id;
    document.getElementById('edit-photo-caption').value = oldCaption;
    toggleModal('edit-modal');
}
function confirmEditPhoto() {
    const id = document.getElementById('edit-photo-id').value;
    const newCaption = document.getElementById('edit-photo-caption').value;
    bmobRequest(`/classes/${PHOTO_TABLE}/${id}`, 'PUT', { caption: newCaption }).then(() => {
        alert('修改成功！'); location.reload();
    }).catch(e => alert('修改失败'));
}
window.deletePhoto = function(id, btnElement) {
    if(!confirm("确定要删除这张照片吗？")) return;
    bmobRequest(`/classes/${PHOTO_TABLE}/${id}`, 'DELETE').then(() => {
        alert('已删除');
        btnElement.closest('.gallery-item').remove();
    }).catch(e => alert('删除失败'));
}

function checkLocalLogin() {
    const savedUser = localStorage.getItem('bmob_user');
    if(savedUser) {
        currentUser = JSON.parse(savedUser);
        if(currentUser.username === 'fangq' || currentUser.isAdmin) {
            isUserAdmin = true; 
            document.getElementById('upload-trigger').style.display = 'block';
            initAdminDrag();
        }
        document.getElementById('login-trigger').innerText = "👤 " + currentUser.username;
    }
}
function restLogin() {
    const u = document.getElementById('username').value, p = document.getElementById('password').value;
    bmobRequest(`/login?username=${u}&password=${p}`, 'GET').then(res => {
        localStorage.setItem('bmob_user', JSON.stringify(res)); localStorage.setItem('bmob_session', res.sessionToken);
        alert('登录成功！'); location.reload();
    }).catch(e => alert('账号或密码错误'));
}
function initTypewriter() {
    const subtitle = document.querySelector('.subtitle'); const text = "记录我们的每一个瞬间"; subtitle.innerText = "";
    let i = 0; function type() { if (i < text.length) { subtitle.innerText += text.charAt(i); i++; setTimeout(type, 200); } } setTimeout(type, 500);
}

document.addEventListener('click', function(e) {
    if(e.target.closest('.modal-box') || e.target.closest('.float-btn') || e.target.closest('.control-btn') || e.target.closest('#photo-comment-sidebar') || e.target.closest('#comment-toggle-btn') || e.target.closest('#music-playlist') || e.target.id === 'music-btn') return;
    const colors = ["#ff7675", "#ff9a9e", "#a29bfe", "#55efc4", "#81ecec"];
    const heart = document.createElement('div'); heart.innerText = '❤'; heart.className = 'click-heart';
    heart.style.left = e.clientX + 'px'; heart.style.top = e.clientY + 'px';
    heart.style.color = colors[Math.floor(Math.random() * colors.length)];
    heart.style.fontSize = Math.random() * 10 + 15 + 'px'; document.body.appendChild(heart); setTimeout(() => heart.remove(), 1000);
});
let isMoving = false;
document.addEventListener('mousemove', function(e) {
    if (isMoving) return; isMoving = true; setTimeout(() => { isMoving = false; }, 30);
    const star = document.createElement('div'); star.className = 'magic-particle';
    const size = Math.random() * 6 + 2; star.style.width = size + 'px'; star.style.height = size + 'px';
    star.style.background = `rgba(${Math.floor(Math.random()*255)}, ${Math.floor(Math.random()*255)}, 255, 0.8)`;
    star.style.left = e.clientX + 'px'; star.style.top = e.clientY + 'px'; document.body.appendChild(star); setTimeout(() => star.remove(), 800);
});

function loadCloudMessages() {
    bmobRequest('/classes/Danmaku?order=-createdAt&limit=50', 'GET').then(data => {
        const list = document.getElementById('message-list'); 
        if (list.innerHTML.includes('Loading...') && (!data.results || data.results.length === 0)) {
            list.innerHTML = '<div style="color:#fff">还没有留言，快来发第一条吧！</div>';
            return;
        }
        if (list.innerHTML.includes('Loading...')) list.innerHTML = '';
        
        if (data.results && data.results.length > 0) {
            data.results.forEach(item => {
                if (!displayedMessageIds.has(item.objectId)) {
                    displayedMessageIds.add(item.objectId);
                    addCardToWall(item.content, item.createdAt.split(' ')[0], item.objectId, true);
                    danmakuQueue.push(item.content);
                }
            });
        }
    });
}
setInterval(loadCloudMessages, 3000);

function saveToCloud(text) { 
    bmobRequest('/classes/Danmaku', 'POST', { content: text }).then(res => {
        displayedMessageIds.add(res.objectId);
        addCardToWall(text, new Date().toLocaleDateString(), res.objectId, true);
    });
} 

window.deleteMessage = function(objectId, element) {
    if(!confirm("确定删除吗？")) return;
    bmobRequest(`/classes/Danmaku/${objectId}`, 'DELETE').then(res => { 
        alert('删除成功'); 
        element.parentElement.remove(); 
        displayedMessageIds.delete(objectId); 
    });
}

function addCardToWall(text, dateStr, objectId, isPrepend = false) {
    const card = document.createElement('div'); card.className = 'message-card';
    let delBtn = (isUserAdmin && objectId) ? `<div class="delete-msg-btn show-admin" onclick="deleteMessage('${objectId}', this)">×</div>` : '';
    card.innerHTML = `${delBtn}${text} <span class="message-time">${dateStr}</span>`;
    const list = document.getElementById('message-list');
    if(list.firstChild) list.insertBefore(card, list.firstChild); else list.appendChild(card);
}

const dmContainer = document.getElementById('danmaku-container'), dmInput = document.getElementById('dm-input'), dmBtn = document.getElementById('dm-btn');

function shootDanmaku(text, isSelf=false) {
    const dm = document.createElement('div'); dm.innerText = text; dm.className = 'danmaku-item';
    const maxLanes = 15; 
    const laneHeight = 5; 
    const lane = danmakuLaneIndex % maxLanes; 
    
    dm.style.top = (5 + lane * laneHeight) + '%'; 
    danmakuLaneIndex++; 

    dm.style.fontSize = (Math.random() * 0.5 + 1.2) + 'rem';
    if(isSelf) { dm.style.color = '#ffeaa7'; dm.style.zIndex = 100; dm.style.border = "1px solid rgba(255,255,255,0.5)"; dm.style.borderRadius = "20px"; dm.style.padding = "2px 10px"; }
    
    const duration = Math.random() * 10 + 20; 
    dm.style.animation = `dmLeft ${duration}s linear forwards`; 
    
    dmContainer.appendChild(dm); 
    setTimeout(() => dm.remove(), duration * 1000 + 1000);
}

function startDanmakuScheduler() {
    const presets = ["永远开心快乐呀！", "今天的风好甜~", "哇，这张照片好美！", "Love You Forever", "要一直幸福下去哦 ❤️", "羡慕这两个人~", "背景音乐好好听", "打卡打卡！", "✨✨✨", "好浪漫呀~"];
    
    setInterval(() => {
        if (danmakuQueue.length > 0) {
            const text = danmakuQueue.shift();
            shootDanmaku(text, false);
        } else {
            if(Math.random() < 0.3) {
                shootDanmaku(presets[Math.floor(Math.random() * presets.length)], false);
            }
        }
    }, 2500);
}

function startRandomAtmosphere() {
    // 留空，逻辑移交 scheduler
}

if(dmBtn) {
    dmBtn.onclick = () => { 
        const t = dmInput.value.trim(); 
        if(t) { 
            shootDanmaku(t, true); 
            saveToCloud(t);      
            dmInput.value = ''; 
        } 
    };
}
if(dmInput) dmInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') dmBtn.click(); });

function updateTimer() {
    const diff = new Date() - new Date("2023-08-21T00:00:00");
    document.getElementById("love-timer").innerHTML = `我们已经在一起 ❤️ ${Math.floor(diff / (86400000))}天 ${Math.floor((diff / 3600000) % 24)}小时 ${Math.floor((diff / 60000) % 60)}分 ${Math.floor((diff / 1000) % 60)}秒`;
}
setInterval(updateTimer, 1000); updateTimer();

const songList = [
    { title: "不是因为寂寞才想你", url: "music/1.mp3" }, 
    { title: "纸短情长", url: "music/2.mp3" }
];
let currentSongIndex = 0;
let isMusicPlaying = false;
const audio = document.getElementById('bg-audio');
const musicBtn = document.getElementById('music-btn');
const playlistContainer = document.getElementById('music-playlist');

function initMusicPlayer() {
    renderPlaylist();
    currentSongIndex = Math.floor(Math.random() * songList.length);
    loadSong(currentSongIndex, false); 

    const playPromise = audio.play();
    if (playPromise !== undefined) {
        playPromise.then(() => {
            updateMusicUI(true);
        }).catch(error => {
            console.log("等待交互...");
            document.body.addEventListener('click', function tryPlay() {
                audio.play();
                updateMusicUI(true);
                document.body.removeEventListener('click', tryPlay);
            }, { once: true });
        });
    }

    audio.addEventListener('ended', () => {
        playNextSong();
    });

    if(musicBtn) {
        musicBtn.onclick = (e) => {
            e.stopPropagation(); 
            if (playlistContainer.classList.contains('show') || playlistContainer.style.display === 'flex') {
                playlistContainer.classList.remove('show');
                playlistContainer.style.display = 'none'; 
            } else {
                playlistContainer.style.display = 'flex'; 
                setTimeout(() => playlistContainer.classList.add('show'), 10);
            }
        };
    }
}

function renderPlaylist() {
    const ul = document.getElementById('playlist-ul');
    if(!ul) return;
    ul.innerHTML = '';
    songList.forEach((song, index) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="playing-icon">🎵</span> ${song.title}`;
        li.onclick = (e) => {
            e.stopPropagation();
            loadSong(index, true); 
        };
        ul.appendChild(li);
    });
}

function loadSong(index, autoPlay) {
    currentSongIndex = index;
    audio.src = songList[index].url;
    
    const items = document.querySelectorAll('#playlist-ul li');
    items.forEach((item, i) => {
        if(i === index) item.classList.add('active');
        else item.classList.remove('active');
    });

    if (autoPlay) {
        audio.play().catch(e => console.log("等待交互"));
        updateMusicUI(true);
    }
}

window.togglePlayPause = function() {
    if (audio.paused) {
        audio.play();
        updateMusicUI(true);
    } else {
        audio.pause();
        updateMusicUI(false);
    }
}

function updateMusicUI(playing) {
    isMusicPlaying = playing;
    const miniBtn = document.getElementById('mini-control-btn');
    if (playing) {
        musicBtn.classList.add('music-playing');
        if(miniBtn) miniBtn.innerText = "暂停播放";
    } else {
        musicBtn.classList.remove('music-playing');
        if(miniBtn) miniBtn.innerText = "继续播放";
    }
}

function playNextSong() {
    currentSongIndex = (currentSongIndex + 1) % songList.length;
    loadSong(currentSongIndex, true);
}

function createStar() {
    const star = document.createElement('div'); star.className = 'star-style';
    star.style.left = Math.random() * 100 + 'vw'; star.style.animation = `starFall ${Math.random() * 3 + 4}s linear forwards`;
    document.body.appendChild(star); setTimeout(() => star.remove(), 7000);
}
const styleSheet = document.createElement("style"); styleSheet.innerText = `@keyframes starFall { 0% { transform: translateY(-100px) rotate(-45deg); opacity: 0; } 10% { opacity: 1; } 100% { transform: translateY(100vh) translateX(-200px) rotate(-45deg); opacity: 0; } } @keyframes dmLeft { from { transform: translateX(100vw); } to { transform: translateX(-100%); } }`;
document.head.appendChild(styleSheet); setInterval(createStar, 700);