(async () => {
  const video = document.getElementById('video');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const status = document.getElementById('status');
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

  // Known faces storage structure in localStorage:
  // { name: string, descriptors: Array<Array<number>>, thumbnail?: string }
  // Loaded into a FaceMatcher as needed
  let faceMatcher = null;
  let labeledDescriptors = [];

  // Load models from CDN
  // Advanced feature flags
  let advEnabled = true; // 默认开启高级功能
  // age/gender and expressions availability
  let ageGenderLoaded = false;
  let expressionsLoaded = false;
  let advancedUnavailable = false; // 默认可用
  async function loadModels(){
    status.textContent = '加载模型中…';
    // 支持多种模型路径，提升在不同网络环境下的成功率
    const modelPaths = [
      // @vladmandic/face-api 的模型（完整包含 age_gender 和 expression 模型）
      'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.5/model',
      // 备用路径
      'https://justadudewhohacks.github.io/face-api.js/models'
    ];
    let loaded = false;
    for (const modelPath of modelPaths){
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(modelPath),
          faceapi.nets.faceLandmark68Net.loadFromUri(modelPath),
          faceapi.nets.faceRecognitionNet.loadFromUri(modelPath)
        ]);
        // Age/Gender and Expressions can be loaded later on demand
        loaded = true;
        break;
      } catch (e) {
        console.warn('模型路径加载失败，尝试下一个：', modelPath, e);
      }
    }
    if(!loaded){
      throw new Error('所有模型路径加载失败');
    }
    }

  function loadKnownFaces(){
    const raw = localStorage.getItem('known_faces');
    if(!raw) { faceMatcher = null; labeledDescriptors = []; return; }
    const data = JSON.parse(raw);
    // rebuild descriptors
    labeledDescriptors = data.map(entry => {
      const descriptors = entry.descriptors.map(d => new Float32Array(d));
      return new faceapi.LabeledFaceDescriptors(entry.name, descriptors);
    });
    // ensure each entry has a stable id; persist if new ids were created
    let needsSave = false;
    data.forEach(entry => {
      if(!entry.id){ entry.id = 'id_' + Math.random().toString(36).slice(2) + Date.now(); needsSave = true; }
    });
    if(needsSave){ localStorage.setItem('known_faces', JSON.stringify(data)); }
    if(labeledDescriptors.length) {
      faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.6);
    } else {
      faceMatcher = null;
    }
  }

  function renderUploadedList(){
    uploadedList.innerHTML = '';
    const raw = localStorage.getItem('known_faces');
    if(!raw){ return; }
    const data = JSON.parse(raw);
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
  }

  function deleteFaceById(id){
    if(!id) return;
    const raw = localStorage.getItem('known_faces');
    if(!raw) return;
    let data = JSON.parse(raw);
    const idx = data.findIndex(e => e.id === id);
    if(idx >= 0){
      const name = data[idx].name;
      if(!confirm(`确定删除人脸 "${name}" 吗？`)) return;
      data.splice(idx, 1);
      localStorage.setItem('known_faces', JSON.stringify(data));
      loadKnownFaces();
      renderUploadedList();
      // Optional user feedback: 简单日志
      console.log(`已删除人脸: ${name}`);
    }
  }

  // Handle image file selection (preview)
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

  // Save uploaded face descriptor with a name
  async function saveDescriptor(name, dataURL){
    // create an image element to run face detection
    const img = new Image();
    img.src = dataURL;
    await new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
    const detections = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
    if(!detections || !detections.descriptor){
      alert('未在图片中检测到人脸，请使用包含清晰人脸的一张图片。');
      return;
    }
    const descriptor = detections.descriptor;
    // update storage: allow multiple descriptors per name
    const raw = localStorage.getItem('known_faces');
    let data = raw ? JSON.parse(raw) : [];
    // find existing entry
    const existing = data.find(e => e.name === name);
    if(existing){
      existing.descriptors.push(Array.from(descriptor));
      existing.thumbnail = existing.thumbnail || lastSelectedDataURL;
      existing.updatedAt = new Date().toISOString();
    }else{
      data.push({ name, descriptors: [Array.from(descriptor)], thumbnail: lastSelectedDataURL || '', updatedAt: new Date().toISOString() });
    }
    localStorage.setItem('known_faces', JSON.stringify(data));
    loadKnownFaces();
    renderUploadedList();
  }

  // Start recognition loop
  async function startRecognition(){
    // 如果没有已知人脸数据，也不要阻塞识别，仍然为陌生人绘制红色框
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
    // ensure canvas size matches video
    video.addEventListener('loadedmetadata', () => {
      overlay.width = video.videoWidth; overlay.height = video.videoHeight;
    });
    // frame loop
    const MATCH_THRESHOLD = 0.6;
    recognitionInterval = setInterval(async () => {
      if(video.readyState !== 4) return; // HAVE_ENOUGH_DATA
      // 构建检测链，根据是否启用年龄/性别和表情推断来扩展结果
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
        // 中文映射
        const genderMap = { male: '男', female: '女' };
        const exprMap = {
          angry: '愤怒', disgust: '厌恶', fearful: '恐惧', happy: '开心',
          neutral: '平静', sad: '悲伤', surprised: '惊讶'
        };
        // label bg
        let label = isKnown ? best.toString() : '陌生人';
        // 尝试附带年龄/性别信息
        const extraParts = [];
        if (typeof d.age === 'number') extraParts.push(Math.round(d.age) + '岁');
        if (typeof d.gender === 'string') extraParts.push(genderMap[d.gender] || d.gender);
        // 表情信息（若模型可提供）
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

  // Initialize
  let modelsReady = false;
  try {
    await loadModels();
    modelsReady = true;
  } catch (e) {
    console.warn('模型加载失败，无法开启实时识别：', e);
    // 不阻塞其他功能，继续加载数据，但禁用识别按钮的提示
    ageGenderLoaded = false;
    // 继续执行其余初始化
  }
  loadKnownFaces();
  renderUploadedList();
  status.textContent = modelsReady ? '模型已加载，就绪' : '模型加载失败';
  // 禁用开启摄像头按钮，直到模型加载完成
  startBtn.disabled = !modelsReady;

  // 自动开启高级模型加载（默认开启）
  if(advEnabled){
    await loadAdvancedModelsFromPaths();
    status.textContent = (ageGenderLoaded || expressionsLoaded) ? '就绪（高级模型已加载）' : '就绪';
    // 高级模型加载完成后也确保按钮可用
    startBtn.disabled = false;
  }

  // Wire up UI
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
    // reset partial state
    lastSelectedDataURL = null;
    preview.innerHTML = '';
    nameInput.value = '';
    renderUploadedList();
  });

  startBtn.addEventListener('click', async () => {
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ alert('当前浏览器不支持摄像头'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = stream; currentStream = stream;
      await video.play();
      startBtn.disabled = true; stopBtn.disabled = false; status.textContent = '摄像头已开启，正在识别……';
      // if there are no known faces yet, warn user
      if(!faceMatcher || !faceMatcher.labeledDescriptors.length){
        // Still run; user will be shown Unknown until faces added
      }
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

  // 全屏功能 - 支持 iOS Safari
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const videoElem = document.getElementById('video');
  const overlayElem = document.getElementById('overlay');
  const videoWrap = document.querySelector('.video-wrap');
  
  // 检测是否是 iOS Safari
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  let isInIOSFullscreen = false;
  
  function toggleFullscreen() {
    // iOS Safari 使用 video.webkitEnterFullscreen
    if (isIOS || isSafari) {
      if (!videoElem.webkitDisplayingFullscreen) {
        // 进入全屏
        videoElem.webkitEnterFullscreen();
        fullscreenBtn.textContent = '退出全屏';
      } else {
        // 退出全屏
        videoElem.webkitExitFullscreen();
        fullscreenBtn.textContent = '全屏';
      }
      return;
    }
    
    // 标准浏览器
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

  // iOS Safari 视频全屏变化监听
  videoElem.addEventListener('webkitbeginfullscreen', () => {
    fullscreenBtn.textContent = '退出全屏';
    isInIOSFullscreen = true;
    // iOS 全屏时隐藏 overlay（因为不在同一层）
    overlayElem.style.display = 'none';
  });
  videoElem.addEventListener('webkitendfullscreen', () => {
    fullscreenBtn.textContent = '全屏';
    isInIOSFullscreen = false;
    // 恢复 overlay
    overlayElem.style.display = 'block';
    // 重新调整 canvas 大小
    overlayElem.width = videoElem.videoWidth;
    overlayElem.height = videoElem.videoHeight;
  });
  
  // 标准全屏变化监听
  document.addEventListener('fullscreenchange', () => {
    fullscreenBtn.textContent = document.fullscreenElement ? '退出全屏' : '全屏';
  });
  document.addEventListener('webkitfullscreenchange', () => {
    fullscreenBtn.textContent = document.webkitFullscreenElement ? '退出全屏' : '全屏';
  });

  // Advanced features toggle: ages, gender, expressions
  const advToggleBtn = document.getElementById('advToggleBtn');
  advToggleBtn.addEventListener('click', async () => {
    if (advancedUnavailable) {
      status.textContent = '高级模型不可用';
      return;
    }
    advEnabled = !advEnabled;
    advToggleBtn.textContent = advEnabled ? '年龄识别：开' : '年龄识别：关';
    if(advEnabled && (!ageGenderLoaded || !expressionsLoaded)){
      await loadAdvancedModelsFromPaths();
    }
    status.textContent = advEnabled ? (ageGenderLoaded || expressionsLoaded ? '就绪' : '就绪（正在尝试加载高级模型）') : '就绪';
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
