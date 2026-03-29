(async () => {
  const API_BASE = '';
  const CLOUD_TOKEN_KEY = 'cloud_token';

  function getToken() {
    return localStorage.getItem(CLOUD_TOKEN_KEY);
  }

  async function apiRequest(url, options = {}) {
    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(API_BASE + url, {
      ...options,
      headers
    });

    if (res.status === 401 || res.status === 403) {
      logout();
      throw new Error('登录已过期');
    }

    return res;
  }

  function logout() {
    localStorage.removeItem(CLOUD_TOKEN_KEY);
    localStorage.removeItem('cloud_user');
    location.href = 'index.html';
  }

  const video = document.getElementById('video');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const status = document.getElementById('status');
  const syncStatus = document.getElementById('syncStatus');
  const fileInput = document.getElementById('fileInput');
  const dropArea = document.getElementById('drop-area');
  const nameInput = document.getElementById('nameInput');
  const addFaceBtn = document.getElementById('addFaceBtn');
  const preview = document.getElementById('preview');
  const uploadedList = document.getElementById('uploadedList');

  let lastSelectedDataURL = null;
  let lastSelectedFileName = '';
  let currentStream = null;
  let recognitionInterval = null;

  let faceMatcher = null;
  let labeledDescriptors = [];

  let advEnabled = true;
  let ageGenderLoaded = false;
  let expressionsLoaded = false;
  let advancedUnavailable = false;

  const progressBar = document.getElementById('progressBar');
  const progress = document.getElementById('progress');

  function showProgress(percent, text) {
    progressBar.classList.add('active');
    progress.style.width = percent + '%';
    if (text) status.textContent = text;
  }

  function hideProgress() {
    progressBar.classList.remove('active');
    progress.style.width = '0%';
  }

  function showSyncStatus(msg, type = 'normal') {
    syncStatus.textContent = msg;
    syncStatus.className = 'sync-status ' + type;
  }

  async function loadModels(){
    showProgress(10, '加载模型中...');
    const modelPaths = [
      'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.5/model',
      'https://justadudewhohacks.github.io/face-api.js/models'
    ];
    let loaded = false;
    for (const modelPath of modelPaths){
      try {
        showProgress(30, '加载检测模型...');
        await faceapi.nets.tinyFaceDetector.loadFromUri(modelPath);
        showProgress(50, '加载特征点模型...');
        await faceapi.nets.faceLandmark68Net.loadFromUri(modelPath);
        showProgress(70, '加载识别模型...');
        await faceapi.nets.faceRecognitionNet.loadFromUri(modelPath);
        loaded = true;
        break;
      } catch (e) {
        console.warn('模型路径加载失败，尝试下一个：', modelPath, e);
      }
    }
    if(!loaded){
      throw new Error('所有模型路径加载失败');
    }
    showProgress(100, '模型加载完成');
    setTimeout(hideProgress, 500);
  }

  async function loadKnownFaces(){
    try {
      const res = await apiRequest('/api/faces');
      const data = await res.json();
      
      labeledDescriptors = data.map(entry => {
        const descriptors = entry.descriptors.map(d => new Float32Array(d));
        return new faceapi.LabeledFaceDescriptors(entry.name, descriptors);
      });
      
      if(labeledDescriptors.length) {
        faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.6);
      } else {
        faceMatcher = null;
      }
      showSyncStatus('已同步');
    } catch (err) {
      console.error('加载人脸数据失败:', err);
      showSyncStatus('同步失败', 'error');
    }
  }

  function renderUploadedList(){
    uploadedList.innerHTML = '';
    
    apiRequest('/api/faces').then(res => res.json()).then(data => {
      const formatDate = (iso) => {
        if(!iso) return '—';
        try {
          return new Date(iso).toLocaleString();
        } catch { return iso; }
      };
      
      data.forEach(item => {
        const div = document.createElement('div');
        div.className = 'record';
        const img = document.createElement('img');
        img.src = item.thumbnail || '';
        const info = document.createElement('div');
        info.style.display = 'flex'; info.style.flexDirection = 'column';
        const nameEl = document.createElement('strong');
        nameEl.textContent = item.name;
        const meta = document.createElement('span');
        meta.style.fontSize = '12px'; meta.style.color = '#555';
        const count = (Array.isArray(item.descriptors) ? item.descriptors.length : 0);
        meta.textContent = `描述数量: ${count}  | 最近更新: ${formatDate(item.updatedAt)}`;
        info.appendChild(nameEl); info.appendChild(meta);
        const actions = document.createElement('div'); actions.style.marginLeft = 'auto';
        const delBtn = document.createElement('button');
        delBtn.textContent = '删除';
        delBtn.className = 'delete-btn';
        delBtn.dataset.id = item.id;
        delBtn.addEventListener('click', () => deleteFaceById(item.id));
        actions.appendChild(delBtn);
        div.appendChild(img); div.appendChild(info); div.appendChild(actions);
        uploadedList.appendChild(div);
      });
    });
  }

  async function deleteFaceById(id){
    if(!id) return;
    if(!confirm('确定删除此人脸吗？')) return;
    
    try {
      showSyncStatus('删除中...', 'syncing');
      const res = await apiRequest('/api/faces/' + id, { method: 'DELETE' });
      
      if(res.ok) {
        await loadKnownFaces();
        renderUploadedList();
        showSyncStatus('已同步');
      } else {
        const data = await res.json();
        alert(data.error || '删除失败');
        showSyncStatus('同步失败', 'error');
      }
    } catch (err) {
      console.error('删除失败:', err);
      showSyncStatus('同步失败', 'error');
    }
  }

  function handleSelectedFile(file){
    if(!file) return;
    lastSelectedFileName = file.name;
    const reader = new FileReader();
    reader.onload = () => {
      lastSelectedDataURL = reader.result;
      preview.innerHTML = '';
      const img = document.createElement('img');
      img.src = lastSelectedDataURL;
      img.style.height = '48px'; img.style.objectFit='cover'; img.style.borderRadius='6px';
      preview.appendChild(img);
    };
    reader.readAsDataURL(file);
  }

  async function saveDescriptor(name, dataURL){
    const img = new Image();
    img.src = dataURL;
    await new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
    const detections = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
    if(!detections || !detections.descriptor){
      alert('未在图片中检测到人脸，请使用包含清晰人脸的一张图片。');
      return;
    }
    const descriptor = detections.descriptor;
    
    try {
      showSyncStatus('保存中...', 'syncing');
      const res = await apiRequest('/api/faces', {
        method: 'POST',
        body: JSON.stringify({
          name,
          descriptors: [Array.from(descriptor)],
          thumbnail: lastSelectedDataURL || ''
        })
      });
      
      const data = await res.json();
      
      if(res.ok) {
        await loadKnownFaces();
        renderUploadedList();
        showSyncStatus('已同步');
      } else {
        alert(data.error || '保存失败');
        showSyncStatus('同步失败', 'error');
      }
    } catch (err) {
      console.error('保存失败:', err);
      alert('保存失败: ' + err.message);
      showSyncStatus('同步失败', 'error');
    }
  }

  async function startRecognition(){
    const hasKnownFaces = !!(faceMatcher && faceMatcher.labeledDescriptors && faceMatcher.labeledDescriptors.length > 0);
    if(!hasKnownFaces){
      status.textContent = '识别：暂无已知人脸数据，将对所有检测框显示为 Unknown';
    }
    status.textContent = '正在识别...';
    const ctx = overlay.getContext('2d');
    function adjustCanvasSize(){
      const w = video.videoWidth || overlay.width;
      const h = video.videoHeight || overlay.height;
      if(!w||!h){ return; }
      overlay.width = w; overlay.height = h;
    }
    video.addEventListener('loadedmetadata', () => {
      overlay.width = video.videoWidth; overlay.height = video.videoHeight;
    });
    const MATCH_THRESHOLD = 0.6;
    recognitionInterval = setInterval(async () => {
      if(video.readyState !== 4) return;
      let chain = faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks().withFaceDescriptors();
      if (ageGenderLoaded || expressionsLoaded) {
        if (ageGenderLoaded) chain = chain.withAgeAndGender();
        if (expressionsLoaded) chain = chain.withFaceExpressions();
      }
      const detections = await chain;
      ctx.clearRect(0,0,overlay.width, overlay.height);
      if(!detections || detections.length === 0) return;
      const resized = faceapi.resizeResults(detections, { width: overlay.width, height: overlay.height });
      for(const d of resized){
      const best = hasKnownFaces ? faceMatcher.findBestMatch(d.descriptor) : null;
      const box = d.detection.box;
      const isKnown = !!best && best.distance <= MATCH_THRESHOLD;
        if(isKnown){
          ctx.strokeStyle = '#00FF00';
        } else {
          ctx.strokeStyle = '#FF0000';
        }
        ctx.lineWidth = 2;
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        const genderMap = { male: '男', female: '女' };
        const exprMap = {
          angry: '愤怒', disgust: '厌恶', fearful: '恐惧', happy: '开心',
          neutral: '平静', sad: '悲伤', surprised: '惊讶'
        };
        let label = isKnown ? best.toString() : '陌生人';
        const extraParts = [];
        if (typeof d.age === 'number') extraParts.push(Math.round(d.age) + '岁');
        if (typeof d.gender === 'string') extraParts.push(genderMap[d.gender] || d.gender);
        if (d.expressions && typeof d.expressions === 'object') {
          let topExpr = null; let topProb = 0;
          for (const [expr, prob] of Object.entries(d.expressions)){
            if (typeof prob === 'number' && prob > topProb){ topProb = prob; topExpr = expr; }
          }
          if (topExpr){ extraParts.push((exprMap[topExpr] || topExpr) + ' ' + Math.round(topProb * 100) + '%'); }
        }
        if (extraParts.length) label += ' | ' + extraParts.join(' ');
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        const textWidth = ctx.measureText(label).width;
        const textHeight = 18;
        ctx.fillRect(box.x, box.y - textHeight, textWidth + 6, textHeight);
        ctx.fillStyle = '#fff';
        ctx.font = '14px sans-serif';
        ctx.fillText(label, box.x + 3, box.y - 4);
      }
    }, 250);
  }

  function stopRecognition(){
    if(recognitionInterval){ clearInterval(recognitionInterval); recognitionInterval = null; }
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0,0,overlay.width, overlay.height);
    status.textContent = '已停止';
  }

  let modelsReady = false;
  try {
    await loadModels();
    modelsReady = true;
  } catch (e) {
    console.warn('模型加载失败，无法开启实时识别：', e);
    ageGenderLoaded = false;
  }
  
  await loadKnownFaces();
  renderUploadedList();
  
  status.textContent = modelsReady ? '模型已加载，就绪' : '模型加载失败';
  startBtn.disabled = !modelsReady;
  showSyncStatus('已同步');

  if(advEnabled){
    await loadAdvancedModelsFromPaths();
    status.textContent = (ageGenderLoaded || expressionsLoaded) ? '就绪（高级模型已加载）' : '就绪';
    startBtn.disabled = false;
  }

  dropArea.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    handleSelectedFile(f);
    lastSelectedFileName = f.name;
  });
  dropArea.addEventListener('dragover', (e) => { e.preventDefault(); dropArea.style.background = '#f0f0f0'; });
  dropArea.addEventListener('dragleave', () => { dropArea.style.background = ''; });
  dropArea.addEventListener('drop', async (e) => {
    e.preventDefault(); dropArea.style.background='';
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if(!f) return;
    fileInput.files = Object.assign(new DataTransfer(), { files: [f] }).files;
    handleSelectedFile(f);
  });

  addFaceBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if(!name){ alert('请为上传的人脸输入一个名称。'); return; }
    if(!lastSelectedDataURL){ alert('请先选择一张脸部图片上传。'); return; }
    await saveDescriptor(name, lastSelectedDataURL);
    lastSelectedDataURL = null;
    preview.innerHTML = '';
    nameInput.value = '';
  });

  startBtn.addEventListener('click', async () => {
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ alert('当前浏览器不支持摄像头'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = stream; currentStream = stream;
      await video.play();
      startBtn.disabled = true; stopBtn.disabled = false; status.textContent = '摄像头已开启，正在识别……';
      await startRecognition();
    } catch (err) {
      console.error(err); alert('无法打开摄像头，请检查浏览器权限。');
    }
  });

  stopBtn.addEventListener('click', () => {
    if(currentStream){ currentStream.getTracks().forEach(t => t.stop()); currentStream = null; }
    stopRecognition();
    startBtn.disabled = false; stopBtn.disabled = true;
  });

  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const videoElem = document.getElementById('video');
  const overlayElem = document.getElementById('overlay');
  
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  let isInIOSFullscreen = false;
  
  function toggleFullscreen() {
    if (isIOS || isSafari) {
      if (!videoElem.webkitDisplayingFullscreen) {
        videoElem.webkitEnterFullscreen();
        fullscreenBtn.textContent = '退出全屏';
      } else {
        videoElem.webkitExitFullscreen();
        fullscreenBtn.textContent = '全屏';
      }
      return;
    }
    
    const videoContainer = document.querySelector('.video-wrap');
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (videoContainer.requestFullscreen) {
        videoContainer.requestFullscreen().catch(err => console.warn('全屏失败:', err));
      } else if (videoContainer.webkitRequestFullscreen) {
        videoContainer.webkitRequestFullscreen().catch(err => console.warn('全屏失败:', err));
      }
      fullscreenBtn.textContent = '退出全屏';
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(err => console.warn('退出全屏失败:', err));
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen().catch(err => console.warn('退出全屏失败:', err));
      }
      fullscreenBtn.textContent = '全屏';
    }
  }
  fullscreenBtn.addEventListener('click', toggleFullscreen);

  videoElem.addEventListener('webkitbeginfullscreen', () => {
    fullscreenBtn.textContent = '退出全屏';
    isInIOSFullscreen = true;
    overlayElem.style.display = 'none';
  });
  videoElem.addEventListener('webkitendfullscreen', () => {
    fullscreenBtn.textContent = '全屏';
    isInIOSFullscreen = false;
    overlayElem.style.display = 'block';
    overlayElem.width = videoElem.videoWidth;
    overlayElem.height = videoElem.videoHeight;
  });
  
  document.addEventListener('fullscreenchange', () => {
    fullscreenBtn.textContent = document.fullscreenElement ? '退出全屏' : '全屏';
  });
  document.addEventListener('webkitfullscreenchange', () => {
    fullscreenBtn.textContent = document.webkitFullscreenElement ? '退出全屏' : '全屏';
  });

  async function loadAdvancedModelsFromPaths(){
    const modelPaths = [
      'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.5/model',
      'https://justadudewhohacks.github.io/face-api.js/models'
    ];
    let loadedAny = false;
    for (const mp of modelPaths){
      try {
        if (typeof faceapi.nets.ageGenderNet?.loadFromUri === 'function' && !ageGenderLoaded){
          await faceapi.nets.ageGenderNet.loadFromUri(mp);
          ageGenderLoaded = true;
        }
        if (typeof faceapi.nets.faceExpressionNet?.loadFromUri === 'function' && !expressionsLoaded){
          await faceapi.nets.faceExpressionNet.loadFromUri(mp);
          expressionsLoaded = true;
        }
        loadedAny = ageGenderLoaded || expressionsLoaded;
        if(loadedAny) break;
      } catch (err){
        console.warn('高级模型加载失败，尝试下一个：', mp, err);
      }
    }
    if(!loadedAny){
      advancedUnavailable = true;
      console.warn('高级模型均不可用，已禁用高级推断。');
      status.textContent = '高级模型不可用';
    }
  }
})();
