const WELCOME_ACCEPTED_KEY = 'systan_welcome_terms_accepted_v1';
const SCHOOL_CODE_KEY = 'systan_school_code_v1';
const SCHOOL_CODE_NAME_KEY = 'systan_school_name_v1';
const SCHOOL_LOGO_KEY_PREFIX = 'systan_school_logo_v1_';
// 管理者のみ参加コードを発行できます。公開前に管理者のGoogleメールまたはUIDを設定してください。
const ADMIN_EMAILS = [
  'yuki.1092.mkupo1216.m@gmail.com'
];
const ADMIN_UIDS = [
  // 'FirebaseAuthUidHere'
];

const USER_SUSPENDED_MESSAGE = '現在、このアカウントは管理者によって、利用停止の状態にさせられています。管理者までお問い合わせください。';

const firebaseConfig = {
  apiKey: "AIzaSyDHKbY8W78Z02at8GZa2fLX65AWo0TsezI",
  authDomain: "systan-app-v6.firebaseapp.com",
  projectId: "systan-app-v6",
  storageBucket: "systan-app-v6.firebasestorage.app",
  messagingSenderId: "932991616778",
  appId: "1:932991616778:web:661dc2452baa2ea1305cf3",
  measurementId: "G-70CB2JGCRC"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const MAINTENANCE_SETTINGS_COLLECTION = 'appSettings';
const MAINTENANCE_SETTINGS_DOC = 'global';
// update.htmlでアプリ更新・Cookie/キャッシュ削除が完了した端末だけ、
// 現在のメンテナンスを自動解除して通常画面へ戻します。
const MAINTENANCE_RELEASE_ID = '2026.05.09-update-cleanup-1';
const MAINTENANCE_CLEANUP_DONE_KEY = 'systan_maintenance_cleanup_done_v1';

function getMaintenanceReleaseId(settings) {
  return String((settings && settings.maintenanceReleaseId) || MAINTENANCE_RELEASE_ID);
}

function isMaintenanceCleanupDoneForDevice(settings) {
  try {
    const requiredId = getMaintenanceReleaseId(settings);
    return localStorage.getItem(MAINTENANCE_CLEANUP_DONE_KEY) === requiredId;
  } catch (e) {
    return false;
  }
}

function waitForAuthReady(timeoutMs = 2500) {
  return new Promise(resolve => {
    let done = false;
    const finish = (user) => {
      if (done) return;
      done = true;
      if (unsubscribe) unsubscribe();
      resolve(user || null);
    };
    let unsubscribe = null;
    try {
      unsubscribe = auth.onAuthStateChanged(user => finish(user));
    } catch (e) {
      resolve(auth.currentUser || null);
      return;
    }
    setTimeout(() => finish(auth.currentUser || null), timeoutMs);
  });
}

async function getGlobalAppSettings() {
  try {
    const snap = await db.collection(MAINTENANCE_SETTINGS_COLLECTION).doc(MAINTENANCE_SETTINGS_DOC).get();
    return snap.exists ? (snap.data() || {}) : {};
  } catch (e) {
    console.warn('getGlobalAppSettings error:', e);
    return {};
  }
}

async function enforceMaintenanceMode() {
  const settings = await getGlobalAppSettings();
  const maintenanceOn = settings.maintenanceMode === true;
  if (!maintenanceOn) return false;

  // この端末で update.html の自動更新・Cookie削除が完了している場合は、
  // メンテナンス画面に戻さず通常利用を許可します。
  if (isMaintenanceCleanupDoneForDevice(settings)) {
    return false;
  }

  const user = await waitForAuthReady();
  const adminByEmail = user && ADMIN_EMAILS.map(v => String(v).toLowerCase()).includes(String(user.email || '').toLowerCase());
  const adminByUid = user && ADMIN_UIDS.includes(user.uid);

  if (adminByEmail || adminByUid) {
    return false;
  }

  const target = './update.html?maintenance=1&v=' + Date.now();
  window.location.replace(target);
  return true;
}

async function setMaintenanceModeOneTap(enabled) {
  if (!auth.currentUser || !isSchoolAdmin()) {
    showSyncStatus('管理者のみ変更できます', true);
    return;
  }
  try {
    const payload = {
      maintenanceMode: !!enabled,
      updatedByUid: auth.currentUser.uid,
      updatedByEmail: auth.currentUser.email || '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    // ONにするたびにリリースIDを更新し、過去の完了済み端末まで無条件で通さないようにします。
    if (enabled) {
      payload.maintenanceReleaseId = 'maintenance-' + Date.now();
    }
    await db.collection(MAINTENANCE_SETTINGS_COLLECTION).doc(MAINTENANCE_SETTINGS_DOC).set(payload, { merge: true });
    showSyncStatus(enabled ? 'メンテナンスをONにしました' : 'メンテナンスをOFFにしました');
    await loadAdminDashboard();
  } catch (e) {
    console.warn('setMaintenanceModeOneTap error:', e);
    showSyncStatus('メンテナンス設定の変更に失敗しました', true);
  }
}

// =========================================================
// SOUND EFFECTS
// =========================================================
let audioCtx = null;
let soundUnlocked = false;

function ensureAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioCtx) audioCtx = new AudioCtx();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  soundUnlocked = true;
  return audioCtx;
}

function unlockSound() {
  ensureAudioContext();
}

document.addEventListener('pointerdown', unlockSound, { passive: true });
document.addEventListener('keydown', unlockSound);

function playTone(freq, startAt, duration, type = 'sine', volume = 0.05) {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

function playCorrectSound() {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime + 0.01;
  playTone(880, now, 0.10, 'sine', 0.045);
  playTone(1174.66, now + 0.11, 0.16, 'sine', 0.05);
}

function playWrongSound() {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime + 0.01;
  playTone(330, now, 0.12, 'square', 0.04);
  playTone(220, now + 0.10, 0.18, 'square', 0.04);
}

function playFinishSound() {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime + 0.01;
  playTone(523.25, now, 0.12, 'triangle', 0.04);
  playTone(659.25, now + 0.13, 0.12, 'triangle', 0.04);
  playTone(783.99, now + 0.26, 0.14, 'triangle', 0.045);
  playTone(1046.50, now + 0.41, 0.28, 'triangle', 0.05);
}

// =========================================================
// OFFLINE CACHE / DATA SAVER
// =========================================================
const APP_CACHE_VERSION = '2026.09.25-onboarding-v2.0';

async function registerOfflineCache() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js?v=' + encodeURIComponent(APP_CACHE_VERSION));
    // Reload once when the new worker takes control so an open tab picks up the new app shell.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (sessionStorage.getItem('systan-sw-reloaded') === APP_CACHE_VERSION) return;
      sessionStorage.setItem('systan-sw-reloaded', APP_CACHE_VERSION);
      location.reload();
    });
    if (reg && reg.update && navigator.onLine) reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && navigator.onLine) reg.update().catch(() => {});
    });
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'CACHE_READY') {
        if (typeof showSyncStatus === 'function') showSyncStatus('オフライン用データを保存しました');
      }
    });
  } catch (err) {
    console.warn('Service Worker registration failed:', err);
  }
}

registerOfflineCache();

// =========================================================
// WORD DATA
// =========================================================
const WORDS_RAW = [
  [false,1,"follow","～の後に続く、～に従う"],
  [false,2,"consider","～を考慮する"],
  [false,3,"increase","増える、～を増やす"],
  [false,4,"expect","～を予期する"],
  [false,5,"decide","～することを決意する"],
  [false,6,"develop","発達する、～を発達させる"],
  [false,7,"provide","～を供給する、与える"],
  [false,8,"continue","続く、～を続ける"],
  [false,9,"include","～を含む、含める"],
  [false,10,"remain","ままでいる"],
  [false,11,"reach","～に着く、～に達する"],
  [false,12,"allow","～を許可する"],
  [false,13,"force","～を強制する"],
  [false,14,"offer","～を申し出る"],
  [false,15,"realize","～を悟る"],
  [false,16,"suggest","～と提案する、～をほのめかす"],
  [false,17,"require","～を必要とする"],
  [false,18,"worry","心配する"],
  [false,19,"wonder","～かと疑問に思う"],
  [false,20,"cost","～を要する"],
  [false,21,"tend","～する傾向がある、～しがちである"],
  [false,22,"depend","～に依存する、～しだいで決まる"],
  [false,23,"share","～を分け合う、共有する"],
  [false,24,"demand","～を要求する"],
  [false,25,"support","～を支持する、～を養う、～を立証する"],
  [true,26,"hire","～を雇う"],
  [false,27,"regard","AをBだと思う、みなす"],
  [false,28,"base","AがBに基づいている"],
  [false,29,"improve","～を向上させる"],
  [false,30,"recognize","～を認める"],
  [false,31,"notice","～に気づく"],
  [false,32,"suppose","～だと思う"],
  [false,33,"raise","～を上げる、～を育てる"],
  [false,34,"prefer","～をより好む"],
  [false,35,"cheer","～を励ます"],
  [false,36,"suffer","～を経験する、受ける、苦しむ"],
  [false,37,"describe","～を描写する、～の特徴を説明する"],
  [false,38,"prevent","～をさまたげる"],
  [false,39,"reduce","～を減らす"],
  [false,40,"mistake","～を誤解する、まちがえる"],
  [false,41,"prepare","～の準備をする"],
  [false,42,"encourage","はげます"],
  [false,43,"prove","～だとわかる"],
  [false,44,"treat","～をあつかう"],
  [false,45,"establish","～を設立する、創立する"],
  [false,46,"relate","関係がある"],
  [false,47,"compare","～を比較する、～をたとえる"],
  [false,48,"spread","～を広げる；広がる"],
  [false,49,"refer","～を指示する"],
  [false,50,"supply","～を供給する"],
  [false,51,"gain","～を得る"],
  [false,52,"destroy","～を破壊する"],
  [false,53,"apply","当てはまる、申し込む"],
  [false,54,"seek","～を求める"],
  [false,55,"search","～を捜す"],
  [false,56,"claim","～と主張する、～を（当然の権利として）要求する"],
  [false,57,"draw","～を引っぱる"],
  [false,58,"refuse","～を断る"],
  [false,59,"respond","～に返答する"],
  [false,60,"mention","～について述べる"],
  [false,61,"judge","～を判断する"],
  [false,62,"approach","～に接近する；～に取り組む；方法"],
  [false,63,"admit","～を認める"],
  [false,64,"reflect","～を反映する、～を反射する"],
  [false,65,"perform","～を行う、～を遂行する"],
  [false,66,"bore","～をうんざりさせる"],
  [false,67,"survive","生き残る"],
  [false,68,"represent","～を表す"],
  [false,69,"argue","～と主張する、～を議論する・口論する"],
  [false,70,"grant","～を認める、～を与える"],
  [false,71,"indicate","～を指し示す"],
  [false,72,"belong","所属している"],
  [false,73,"acquire","～を習得する"],
  [false,74,"reply","返事をする"],
  [false,75,"feed","～にエサをやる"],
  [false,76,"escape","逃げる"],
  [false,77,"replace","～に取って代わる、～を取り替える"],
  [false,78,"reveal","～を明らかにする"],
  [false,79,"surround","～を取り囲む"],
  [false,80,"suit","～に合う"],
  [false,81,"estimate","～を推定する"],
  [false,82,"aim","～をねらう"],
  [false,83,"earn","～をもうける、かせぐ"],
  [false,84,"decline","衰退する、低下する、～を辞退する"],
  [false,85,"afford","～をする余裕がある"],
  [false,86,"confuse","～を当惑させる"],
  [false,87,"graduate","～を卒業する"],
  [false,88,"vary","変わる、さまざまである"],
  [false,89,"remove","～を移す、取り去る"],
  [false,90,"insist","～と主張する、言い張る"],
  [false,91,"examine","～を調査する"],
  [false,92,"remind","ＡにＢを思い出させる"],
  [false,93,"contribute","～に貢献する、～の一因となる、AをBに寄付する"],
  [false,94,"warn","～に警告する"],
  [false,95,"connect","～をつなぐ"],
  [false,96,"match","～に匹敵する、～に調和する"],
  [false,97,"focus","焦点を合わせる"],
  [false,98,"reject","～を断る"],
  [false,99,"convince","～を納得させる、確信させる"],
  [false,100,"associate","AをBに関連づける、AからBを連想する"],
  [false,101,"rush","急いで行く"],
  [false,102,"stress","～を強調する"],
  [false,103,"attract","～を引きつける"],
  [false,104,"rely","Aに頼る"],
  [false,105,"regret","～を後悔する"],
  [false,106,"adopt","～を採用する"],
  [false,107,"shake","～を振る"],
  [false,108,"hurt","～を傷つける"],
  [false,109,"operate","作動する、～を操作する、手術する"],
  [false,110,"extend","～を広げる、延長する"],
  [false,111,"blame","～を非難する、～のせいにする"],
  [false,112,"consist","Aで構成されている"],
  [false,113,"persuade","～を説得する"],
  [false,114,"admire","～に感心する"],
  [false,115,"disappoint","～を失望させる"],
  [false,116,"expand","拡大する"],
  [false,117,"preserve","～を保護する"],
  [false,118,"struggle","苦闘する、もがく"],
  [false,119,"arrange","～の手はずを整える、～を配列する"],
  [false,120,"disturb","～を妨げる"],
  [false,121,"employ","～を雇う、～を用いる"],
  [false,122,"engage","Aに従事する、Aを行う"],
  [false,123,"abandon","～を捨てる"],
  [false,124,"display","～を展示する、～を表す"],
  [false,125,"encounter","～に偶然出会う"],
  [false,126,"amuse","～を楽しませる"],
  [false,127,"bother","～に面倒をかける、困らせる"],
  [false,128,"concentrate","集中する"],
  [false,129,"adapt","～を適応させる、適応する"],
  [false,130,"puzzle","～を当惑させる"],
  [false,131,"appeal","Aに訴える、～を引きつける"],
  [false,132,"combine","～を結合させる"],
  [false,133,"delay","～を遅らせる"],
  [false,134,"repair","～を修理する"],
  [false,135,"fascinate","～を夢中にさせる"],
  [false,136,"pardon","～を許す"],
  [false,137,"import","～を輸入する"],
  [false,138,"remark","述べる"],
  [false,139,"reserve","～を予約する、～を取っておく"],
  [false,140,"amaze","～を驚嘆させる"],
  [false,141,"frighten","～をおびえさせる"],
  [false,142,"release","～を解放する、～を発表する"],
  [false,143,"rent","～を賃借りする"],
  [false,144,"recover","Aから回復する"],
  [false,145,"suspect","～ではないかと思う、～を疑う"],
  [false,146,"deliver","～を配達する、渡す、～をする"],
  [false,147,"identify","～の正体をつきとめる、Aと共感する"],
  [false,148,"locate","位置する"],
  [false,149,"manufacture","～を製造する"],
  [false,150,"occupy","～を占める"],
  [false,151,"own","～を所有している"],
  [false,152,"expose","ＡをＢにさらす"],
  [false,153,"translate","～を翻訳する"],
  [false,154,"cure","～を治療する"],
  [false,155,"perceive","～を知覚する"],
  [false,156,"adjust","～に慣れる、調節して合わせる"],
  [false,157,"alarm","～をぎょっとさせる、おびえさせる"],
  [false,158,"assist","～を助ける、～を手伝う"],
  [false,159,"freeze","凍りつく"],
  [false,160,"spoil","～を台無しにする"],
  [false,161,"shift","～を変える"],
  [false,162,"embarrass","～を困惑させる、～に恥ずかしい思いをさせる"],
  [false,163,"approve","賛成する；～を承認する"],
  [false,164,"weigh","～の重さがある、～を比較検討する、よく考える"],
  [false,165,"stretch","～を広げる"],
  [false,166,"participate","Aに参加する"],
  [false,167,"exhibit","～を展示する"],
  [false,168,"owe","AのことはBのおかげだ"],
  [false,169,"celebrate","～を祝う"],
  [false,170,"decorate","～を装飾する"],
  [false,171,"forgive","～を許す"],
  [false,172,"seat","(be seated)座っている"],
  [false,173,"injure","～を傷つける"],
  [false,174,"sew","～を縫う"],
  [false,175,"result","結果"],
  [false,176,"feature","特徴"],
  [false,177,"society","社会、協会、団体"],
  [false,178,"wheel","車輪、ハンドル"],
  [false,179,"value","価値"],
  [false,180,"effect","効果、影響、結果"],
  [false,181,"individual","個人"],
  [false,182,"influence","影響"],
  [false,183,"fee","謝礼、料金"],
  [false,184,"rate","割合、速度"],
  [false,185,"sign","印、兆候"],
  [false,186,"service","公共事業、業務"],
  [false,187,"advance","前進、進歩"],
  [true,188,"laughter","笑い"],
  [false,189,"material","物質"],
  [false,190,"industry","工業"],
  [false,191,"attempt","試み"],
  [false,192,"trade","貿易"],
  [false,193,"progress","進歩、前進"],
  [false,194,"excuse","言い訳"],
  [false,195,"custom","習慣、税関"],
  [false,196,"passage","一節、経過、通行"],
  [false,197,"economy","経済"],
  [false,198,"track","小道、足跡"],
  [true,199,"transportation","交通機関、輸送"],
  [false,200,"official","役人"],
  [false,201,"sight","見ること、光景、視力"],
  [false,202,"taste","味、好み"],
  [false,203,"range","範囲"],
  [false,204,"appointment","約束、予約"],
  [false,205,"patient","患者、忍耐強い"],
  [false,206,"project","計画"],
  [false,207,"favor","好意"],
  [false,208,"appearance","外見、様子、出現"],
  [false,209,"risk","危険"],
  [false,210,"benefit","利益"],
  [false,211,"resident","住民"],
  [false,212,"relative","親族、親戚"],
  [false,213,"region","地域"],
  [false,214,"characteristic","特徴"],
  [false,215,"pain","苦痛"],
  [true,216,"twin","双子の一方、双生児"],
  [false,217,"occasion","場合、機会"],
  [false,218,"principle","原理、原則"],
  [false,219,"department","部門、学科"],
  [false,220,"duty","義務、関税"],
  [false,221,"scene","場面、現場"],
  [false,222,"jam","渋滞"],
  [false,223,"spirit","精神"],
  [false,224,"medium","手段"],
  [false,225,"mass","一般大衆、多くの"],
  [false,226,"audience","聴衆、観客"],
  [false,227,"element","要素、元素"],
  [false,228,"climate","気候"],
  [false,229,"revolution","革命"],
  [false,230,"quarter","4分の1"],
  [false,231,"furniture","家具"],
  [false,232,"brain","脳"],
  [false,233,"atmosphere","大気、雰囲気"],
  [false,234,"property","財産"],
  [false,235,"reward","報酬"],
  [false,236,"security","安全"],
  [false,237,"delight","大喜び"],
  [false,238,"desert","砂漠"],
  [false,239,"background","背景、生い立ち、経歴"],
  [false,240,"trend","傾向"],
  [false,241,"vote","投票"],
  [false,242,"impact","影響、衝撃"],
  [false,243,"institution","機関、制度"],
  [false,244,"interaction","交流"],
  [false,245,"alternative","代わりのもの"],
  [false,246,"harm","害"],
  [false,247,"agency","機関、代理店"],
  [false,248,"capacity","能力"],
  [false,249,"minister","大臣"],
  [false,250,"volunteer","ボランティア"],
  [false,251,"access","利用する権利"],
  [false,252,"quantity","量"],
  [false,253,"branch","枝、支店、支局、部門、分野"],
  [false,254,"common","共通の、普通の"],
  [false,255,"rough","荒い、大雑把な"],
  [false,256,"likely","ありそうな、～する可能性が高い"],
  [false,257,"serious","深刻な"],
  [false,258,"particular","ある特定の、特有の"],
  [false,259,"available","手に入る、利用できる"],
  [true,260,"bilingual","二言語使用の"],
  [false,261,"ready","用意ができた"],
  [false,262,"correct","正しい"],
  [false,263,"familiar","熟知している、くわしい"],
  [false,264,"physical","身体の、肉体の"],
  [false,265,"worth","～の価値がある"],
  [false,266,"involved","～に関係している、参加している"],
  [true,267,"fantastic","すばらしい"],
  [false,268,"private","個人の、私的な"],
  [false,269,"obvious","明白な"],
  [false,270,"native","母国の"],
  [false,271,"complex","複雑な"],
  [false,272,"willing","～する気がある、～してもかまわない"],
  [false,273,"current","最新の"],
  [false,274,"male","男の"],
  [false,275,"proper","適切な"],
  [false,276,"capable","～する能力がある"],
  [false,277,"independent","独立した"],
  [false,278,"positive","積極的な"],
  [false,279,"pleasant","楽しい"],
  [false,280,"significant","重要な"],
  [false,281,"former","前の"],
  [false,282,"chemical","化学的な"],
  [false,283,"upset","動揺している"],
  [false,284,"previous","前の"],
  [false,285,"calm","冷静な"],
  [false,286,"specific","特定の"],
  [false,287,"conscious","意識している"],
  [false,288,"superior","よりすぐれている"],
  [false,289,"efficient","効率がいい"],
  [false,290,"fundamental","基本的な"],
  [false,291,"narrow","狭い"],
  [false,292,"reasonable","理にかなった"],
  [false,293,"nervous","神経質な、不安な"],
  [false,294,"alike","似ている"],
  [false,295,"domestic","家庭の、国内の"],
  [false,296,"negative","否定の"],
  [false,297,"moral","道徳的な"],
  [false,298,"eager","熱望している"],
  [true,299,"remarkable","すばらしい"],
  [false,300,"evil","悪い"],
  [false,301,"awake","目を覚まして"],
  [false,302,"aged","年老いた"],
  [false,303,"anxious","心配して、切望して"],
  [false,304,"tough","たくましい、骨の折れる"],
  [false,305,"nuclear","核の、原子力の"],
  [false,306,"legal","合法の、法律の"],
  [false,307,"curious","好奇心の強い"],
  [false,308,"civil","一般市民の"],
  [false,309,"recent","最近の"],
  [false,310,"senior","上級の、先輩の"],
  [true,311,"afterward","その後"],
  [false,312,"nearly","ほとんど"],
  [false,313,"therefore","それゆえに"],
  [false,314,"exactly","正確に"],
  [false,315,"possibly","ひょっとすると、どうしてもVできない"],
  [false,316,"contrary","反対に"],
  [false,317,"occasionally","時々"],
  [false,318,"somehow","どういうわけか、なぜか"],
  [false,319,"seldom","めったに～ない"],
  [true,320,"thus","それゆえ、そのように"],
  [true,321,"throughout","いたる所に"],
  [true,322,"unlike","～と違って"],
  [true,323,"besides","～に加えて"],
  [true,324,"beyond","～の向こうに；～できる範囲をこえて"],
  [true,325,"within","～以内で"],
  [true,326,"nor","～もない"],
  [true,327,"unless","～しない限り"],
  [true,328,"except","～を除いて"],
  [true,329,"ought","～すべきである"],
  [true,330,"in spite of","～にもかかわらず"],
  [true,331,"whether","～かどうか、～であろうとなかろうと"],
  [false,332,"explain","～を説明する"],
  [false,333,"accept","～を受け入れる"],
  [false,334,"produce","～を生産する"],
  [false,335,"exist","存在する"],
  [false,336,"express","～を表現する"],
  [false,337,"add","～を加える"],
  [false,338,"avoid","～を避ける"],
  [false,339,"marry","～と結婚する"],
  [false,340,"protect","～を守る"],
  [false,341,"affect","～に影響する"],
  [false,342,"determine","～を決定する"],
  [false,343,"solve","～を解決する"],
  [false,344,"contain","～を含んでいる"],
  [false,345,"discuss","～を議論する"],
  [false,346,"ignore","～を無視する"],
  [false,347,"guess","～を推測する"],
  [false,348,"exchange","交換する"],
  [false,349,"satisfy","～を満たす"],
  [false,350,"complain","苦情を言う"],
  [false,351,"achieve","～を達成する"],
  [false,352,"enable","～を可能にする"],
  [false,353,"intend","つもりだ"],
  [false,354,"obtain","～を得る"],
  [false,355,"divide","分割する"],
  [false,356,"annoy","～をいらいらさせる"],
  [false,357,"differ","異なる"],
  [false,358,"educate","～を教育する"],
  [false,359,"borrow","～を借りる"],
  [false,360,"invent","～を発明する"],
  [false,361,"promote","～を促進する"],
  [false,362,"advise","～に忠告する"],
  [false,363,"retire","辞める"],
  [false,364,"permit","～を許す"],
  [false,365,"recommend","～を勧める"],
  [false,366,"apologize","謝る"],
  [false,367,"inform","～に知らせる"],
  [false,368,"oppose","～に反対する"],
  [false,369,"trust","～を信用する"],
  [false,370,"select","～を選ぶ"],
  [false,371,"praise","～をほめる"],
  [false,372,"handle","～に対処する"],
  [false,373,"propose","～を提案する"],
  [false,374,"breathe","～を呼吸する"],
  [false,375,"criticize","～を非難する"],
  [false,376,"overcome","～に打ち勝つ"],
  [false,377,"possess","～を持っている"],
  [false,378,"predict","～を予言する"],
  [false,379,"publish","～を出版する"],
  [true,380,"floating","浮かぶ"],
  [false,381,"recall","～を思い出す"],
  [false,382,"explore","～を探検する"],
  [false,383,"pretend","ふりをする"],
  [false,384,"absorb","～を吸収する"],
  [false,385,"resemble","～に似ている"],
  [false,386,"tear","～を引き裂く"],
  [false,387,"consume","～を消費する"],
  [false,388,"compete","競争する"],
  [false,389,"quit","～をやめる"],
  [false,390,"announce","～を発表する"],
  [false,391,"react","反応する"],
  [false,392,"wander","歩き回る"],
  [true,393,"text","メールを送る"],
  [false,394,"generate","～を生み出す"],
  [false,395,"score","～を取る"],
  [false,396,"government","政府"],
  [false,397,"knowledge","知識"],
  [false,398,"nation","国"],
  [false,399,"effort","努力"],
  [false,400,"period","時代"],
  [false,401,"population","人口"],
  [false,402,"purpose","目的"],
  [false,403,"behavior","行動"],
  [false,404,"lack","不足"],
  [false,405,"skill","技術"],
  [false,406,"quality","質"],
  [false,407,"environment","環境"],
  [false,408,"role","役割"],
  [false,409,"attitude","態度"],
  [false,410,"author","筆者"],
  [false,411,"research","研究"],
  [false,412,"opportunity","機会"],
  [false,413,"source","源"],
  [false,414,"carbon","炭素"],
  [false,415,"shape","形"],
  [false,416,"advantage","利点"],
  [false,417,"method","方法"],
  [false,418,"habit","習慣"],
  [false,419,"detail","細部"],
  [false,420,"distance","距離"],
  [false,421,"crowd","群衆"],
  [false,422,"instance","例"],
  [false,423,"desire","願望"],
  [false,424,"standard","水準"],
  [false,425,"task","仕事"],
  [false,426,"generation","世代"],
  [false,427,"responsibility","責任"],
  [false,428,"experiment","実験"],
  [false,429,"athlete","運動選手"],
  [false,430,"decade","10年"],
  [false,431,"loss","損失"],
  [false,432,"fever","熱"],
  [false,433,"theory","理論"],
  [false,434,"statement","記述"],
  [false,435,"professor","教授"],
  [false,436,"function","機能"],
  [false,437,"surface","表面"],
  [false,438,"envelope","封筒"],
  [false,439,"organization","組織"],
  [false,440,"policy","政策"],
  [false,441,"resource","資源"],
  [false,442,"contrast","対比"],
  [false,443,"flood","洪水"],
  [true,444,"mate","連れ合い"],
  [false,445,"goods","商品"],
  [false,446,"creature","動物"],
  [false,447,"structure","構造"],
  [false,448,"tradition","伝統"],
  [false,449,"weight","体重"],
  [false,450,"charity","慈善"],
  [false,451,"citizen","市民"],
  [false,452,"impression","印象"],
  [false,453,"cartoon","マンガ"],
  [false,454,"career","経歴"],
  [false,455,"site","用地"],
  [true,456,"passenger","乗客"],
  [false,457,"violence","暴力"],
  [false,458,"income","所得"],
  [false,459,"temperature","気温"],
  [false,460,"majority","大多数"],
  [false,461,"origin","起源"],
  [false,462,"literature","文学"],
  [false,463,"equipment","設備"],
  [false,464,"stranger","見知らぬ人"],
  [false,465,"strength","強さ"],
  [false,466,"planet","惑星"],
  [false,467,"fiction","小説"],
  [false,468,"religion","宗教"],
  [false,469,"pollution","汚染"],
  [false,470,"wealth","富"],
  [false,471,"document","文書"],
  [false,472,"profit","もうけ"],
  [false,473,"technique","技術"],
  [false,474,"emotion","感情"],
  [false,475,"phenomenon","現象"],
  [false,476,"horror","恐怖"],
  [true,477,"ladder","はしご"],
  [false,478,"billion","十億"],
  [false,479,"status","地位"],
  [false,480,"youth","若者"],
  [false,481,"confidence","自信"],
  [false,482,"edge","周辺"],
  [false,483,"household","家庭"],
  [false,484,"scholar","学者"],
  [false,485,"survey","調査"],
  [false,486,"vocabulary","語彙"],
  [false,487,"enemy","敵"],
  [false,488,"construction","建設"],
  [false,489,"lecture","講義"],
  [false,490,"instruction","指示"],
  [false,491,"crisis","危機"],
  [false,492,"instrument","器具"],
  [false,493,"crop","作物"],
  [false,494,"weapon","兵器"],
  [false,495,"device","装置"],
  [false,496,"path","道"],
  [false,497,"earthquake","地震"],
  [false,498,"stream","小川"],
  [false,499,"notion","概念"],
  [false,500,"yard","庭"],
  [false,501,"victim","犠牲者"],
  [false,502,"fuel","燃料"],
  [false,503,"ancestor","祖先"],
  [false,504,"soil","土壌"],
  [false,505,"debate","討論"],
  [false,506,"crime","犯罪"],
  [false,507,"colleague","同僚"],
  [false,508,"shelf","棚"],
  [false,509,"analysis","分析"],
  [false,510,"universe","宇宙"],
  [false,511,"electricity","電気"],
  [false,512,"insect","昆虫"],
  [false,513,"web","巣"],
  [false,514,"storm","嵐"],
  [false,515,"plenty","十分な"],
  [false,516,"agriculture","農業"],
  [false,517,"gene","遺伝子"],
  [false,518,"evidence","証拠"],
  [false,519,"consequence","結果"],
  [false,520,"infant","幼児"],
  [false,521,"leisure","暇"],
  [false,522,"cell","細胞"],
  [false,523,"talent","才能"],
  [false,524,"advertising","広告"],
  [true,525,"extent","程度"],
  [false,526,"garbage","ごみ"],
  [false,527,"general","一般"],
  [false,528,"various","さまざまな"],
  [false,529,"similar","似ている"],
  [false,530,"complete","完全な"],
  [false,531,"sharp","急激な"],
  [false,532,"expensive","高価な"],
  [false,533,"political","政治的な"],
  [false,534,"aware","気づいている"],
  [false,535,"ancient","古代の"],
  [false,536,"medical","医学の"],
  [false,537,"essential","不可欠だ"],
  [false,538,"huge","巨大な"],
  [false,539,"terrible","ひどい"],
  [false,540,"practical","実用的な"],
  [false,541,"entire","全"],
  [false,542,"favorite","いちばん好きな"],
  [false,543,"comfortable","快適な"],
  [false,544,"minor","小さい"],
  [false,545,"typical","典型的な"],
  [false,546,"ideal","理想的な"],
  [false,547,"principal","主要な"],
  [false,548,"appropriate","適切な"],
  [false,549,"empty","からの"],
  [false,550,"rapid","急速な"],
  [false,551,"mental","精神の"],
  [false,552,"excellent","すばらしい"],
  [false,553,"convenient","都合がいい"],
  [false,554,"potential","潜在的な"],
  [false,555,"financial","財政的な"],
  [false,556,"enormous","莫大な"],
  [false,557,"rare","珍しい"],
  [false,558,"artificial","人工"],
  [false,559,"tiny","ちっちゃな"],
  [false,560,"considerable","かなりの"],
  [false,561,"sensitive","敏感な"],
  [false,562,"intellectual","知的な"],
  [false,563,"thirsty","のどが渇く"],
  [false,564,"polite","礼儀正しい"],
  [false,565,"accurate","正確な"],
  [false,566,"rude","失礼な"],
  [false,567,"sufficient","十分な"],
  [false,568,"urban","都会の"],
  [false,569,"temporary","一時的な"],
  [false,570,"primitive","原始的な"],
  [false,571,"permanent","永久"],
  [false,572,"elderly","高齢の"],
  [false,573,"severe","厳しい"],
  [false,574,"brief","簡潔な"],
  [false,575,"mobile","流動的な"],
  [false,576,"latest","最新の"],
  [false,577,"military","軍事的な"],
  [false,578,"strict","厳しい"],
  [false,579,"solid","固体の"],
  [false,580,"stupid","ばかな"],
  [false,581,"biological","生物"],
  [false,582,"probably","おそらく"],
  [false,583,"hardly","ほとんど～ない"],
  [false,584,"immediately","すぐに"],
  [false,585,"eventually","ついに"],
  [false,586,"frequently","しばしば"],
  [false,587,"extremely","非常に"],
  [false,588,"gradually","だんだん"],
  [false,589,"instantly","すぐに"],
  [false,590,"nevertheless","それにもかかわらず"],
  [false,591,"moreover","その上"],
  [false,592,"relatively","比較的"],
  [false,593,"apparently","一見"],
  [false,594,"definitely","絶対"],
  [false,595,"largely","主に"],
  [false,596,"mostly","大部分は"],
  [false,597,"approximately","およそ"],
  [false,598,"overnight","一晩"],
  [true,599,"accidentally","偶然"],
  [false,600,"despite","にもかかわらず"],
  [false,601,"proceed","進む"],
  [false,602,"ensure","～を確実にする"],
  [false,603,"interpret","～を解釈する"],
  [false,604,"cease","～しなくなる"],
  [false,605,"ban","（公式に）～を禁止する"],
  [false,606,"obey","～に従う"],
  [false,607,"eliminate","(不要なもの)を除去する"],
  [false,608,"resist","～に抵抗する"],
  [false,609,"accompany","〈人〉に同伴する"],
  [false,610,"commit","〈罪など〉を犯す、～をゆだねる、委任する、(本気で)取り組む"],
  [false,611,"pursue","～を追求する"],
  [false,612,"demonstrate","(証明などが)～を明らかに示す"],
  [false,613,"bet","きっと～だと思う"],
  [false,614,"ruin","～を台無しにする、破滅させる"],
  [false,615,"threaten","～を脅迫する"],
  [false,616,"attach","AをBにくっつける"],
  [false,617,"reverse","～を反対にする、逆転する"],
  [false,618,"restrict","～を制限する"],
  [false,619,"compose","～を組み立てる"],
  [false,620,"lean","よりかかる、もたれる"],
  [false,621,"substitute","～を代わりに用いる"],
  [false,622,"trace","～の跡をたどる"],
  [false,623,"interrupt","～を妨げる"],
  [false,624,"confront","～の前に立ちふさがる、～に立ち向かう"],
  [false,625,"illustrate","～を（例で）示す"],
  [false,626,"arrest","～を逮捕する"],
  [false,627,"stimulate","～を刺激する"],
  [false,628,"assure","（～を）保証する"],
  [false,629,"consult","～に相談する、～を参照する"],
  [false,630,"depress","～を憂鬱にさせる"],
  [false,631,"crash","激突する"],
  [false,632,"inspire","～を奮起させる、やる気にさせる"],
  [false,633,"specialize","Aを専門にする、専攻する"],
  [false,634,"cultivate","(植物)を栽培する、(感情・能力などを)育む"],
  [false,635,"fulfill","(約束・夢など)を果たす"],
  [false,636,"transmit","～を送る、伝える"],
  [false,637,"found","～を創立する、設立する"],
  [true,638,"clap","(手など)をたたく"],
  [false,639,"burst","破裂する、突然～しだす"],
  [false,640,"bow","おじぎする"],
  [false,641,"dismiss","(考えなど)を無視する、(人)を解雇する、解散する"],
  [false,642,"breed","～を繁殖させる、繁殖する"],
  [false,643,"prohibit","〈法・団体が〉～を禁じる"],
  [false,644,"oblige","～に強いる"],
  [false,645,"qualify","Aに適任である"],
  [false,646,"invest","（金）を投資する"],
  [false,647,"grasp","～を理解する"],
  [false,648,"collapse","崩壊する"],
  [false,649,"overlook","～を見落とす、～を見逃す"],
  [false,650,"accuse","～を非難する"],
  [false,651,"frustrate","〈人〉を欲求不満にさせる"],
  [false,652,"deprive","AからBを奪う"],
  [false,653,"astonish","～を驚嘆させる"],
  [false,654,"register","～を登録する"],
  [false,655,"correspond","一致する"],
  [false,656,"cast","～を投げる"],
  [false,657,"attribute","AはBのおかげだと思う"],
  [false,658,"neglect","～を無視する、怠る"],
  [false,659,"starve","飢える"],
  [false,660,"resolve","(問題など)を解決する"],
  [false,661,"impose","AをBに課す、押し付ける"],
  [false,662,"convert","～を転換する"],
  [false,663,"scare","～をおびえさせる"],
  [false,664,"constitute","～を構成する、占める、～である"],
  [false,665,"appoint","～を任命する"],
  [false,666,"imply","～を(暗に)意味する"],
  [false,667,"assign","(仕事・物)を割り当てる"],
  [false,668,"nod","うなずく"],
  [false,669,"elect","～を選挙で選ぶ"],
  [false,670,"transfer","～を移す"],
  [false,671,"rob","AからBを奪う"],
  [false,672,"capture","～を捕らえる"],
  [false,673,"undertake","（仕事など）を引き受ける"],
  [false,674,"drown","おぼれ死ぬ"],
  [false,675,"split","～を割る、分裂する"],
  [false,676,"resort","Aに訴える"],
  [false,677,"descend","下る、降りる"],
  [false,678,"irritate","～をいらだたせる"],
  [false,679,"pronounce","〈単語など〉を発音する"],
  [false,680,"equip","～を装備させる"],
  [false,681,"cheat","いかさまをする"],
  [false,682,"emerge","〈隠れていたものが〉現れる"],
  [false,683,"devote","～をささげる"],
  [false,684,"heal","〈けがなど〉を治す、治る"],
  [false,685,"urge","～に強く迫る、～を説得する"],
  [false,686,"envy","～をうらやむ"],
  [false,687,"chase","～を追いかける"],
  [false,688,"prompt","～を促す"],
  [false,689,"withdraw","～を引っ込める、引きこもる、退く、(預金など)を引き出す"],
  [false,690,"detect","～を探知する、～を発見する"],
  [false,691,"interfere","Aを邪魔する"],
  [false,692,"kid","冗談を言う、からかう"],
  [false,693,"launch","(ロケットなど)を打ち上げる"],
  [false,694,"endanger","～を危険にさらす"],
  [false,695,"foster","～を促進する、育成する"],
  [false,696,"diminish","減少する、衰える、～を減らす"],
  [false,697,"spill","～をこぼす"],
  [false,698,"infect","〈人〉に感染する"],
  [false,699,"stem","Aから生じる、Aに由来する"],
  [false,700,"tap","～を軽くたたく"],
  [false,701,"embrace","受け入れる、含む"],
  [false,702,"proportion","比率"],
  [false,703,"contract","契約"],
  [true,704,"chest","胸"],
  [false,705,"treasure","財宝"],
  [false,706,"stock","株(式)"],
  [false,707,"facility","設備、施設"],
  [false,708,"sum","金額、合計、要約"],
  [false,709,"rank","地位"],
  [false,710,"democracy","民主主義、民主国家"],
  [false,711,"emergency","緊急事態"],
  [false,712,"protest","抗議"],
  [false,713,"immigrant","移民"],
  [false,714,"vehicle","車、乗り物、手段"],
  [false,715,"routine","決まりきった仕事、日課"],
  [false,716,"stuff","物"],
  [false,717,"row","列"],
  [true,718,"profile","プロフィール、人物紹介、横顔"],
  [false,719,"dawn","夜明け"],
  [false,720,"welfare","福祉"],
  [false,721,"perspective","見方"],
  [false,722,"enthusiasm","熱意、情熱"],
  [false,723,"faith","信頼"],
  [false,724,"occupation","職業、占領"],
  [false,725,"witness","証人、目撃者"],
  [false,726,"kingdom","王国"],
  [false,727,"equivalent","同等のもの、相当するもの"],
  [false,728,"objective","目的、目標、客観的な"],
  [false,729,"pile","積み重ね"],
  [false,730,"shelter","避難(所)"],
  [false,731,"trial","試み、裁判"],
  [false,732,"honor","名誉"],
  [false,733,"territory","領土、なわ張り"],
  [false,734,"frame","わく"],
  [false,735,"border","国境地帯"],
  [true,736,"statistics","統計(学)"],
  [false,737,"enterprise","企業、事業"],
  [false,738,"context","文脈、状況"],
  [false,739,"load","荷物"],
  [false,740,"grain","穀物"],
  [false,741,"review","再検討"],
  [false,742,"prejudice","偏見"],
  [false,743,"strain","負担"],
  [false,744,"trap","わな、閉じ込められる、わなにかける"],
  [false,745,"temper","気性"],
  [false,746,"slave","奴隷"],
  [false,747,"wound","傷"],
  [false,748,"divorce","離婚"],
  [false,749,"tune","曲"],
  [false,750,"height","高さ、最盛期"],
  [false,751,"faculty","学部、能力"],
  [false,752,"span","期間"],
  [false,753,"dimension","側面、要素、次元"],
  [false,754,"version","型、...版、翻訳、説明"],
  [false,755,"parallel","類似(物)、匹敵するもの"],
  [false,756,"horizon","地平線"],
  [false,757,"acquaintance","知人"],
  [false,758,"burden","重荷"],
  [false,759,"basis","基礎、根拠、方式、やり方"],
  [false,760,"poison","毒"],
  [false,761,"constitution","憲法"],
  [false,762,"administration","経営、行政"],
  [false,763,"charm","魅力"],
  [false,764,"organ","臓器、器官"],
  [false,765,"prey","獲物、えじき"],
  [false,766,"venture","冒険的事業"],
  [false,767,"mission","使命、任務"],
  [false,768,"inquiry","調査、質問、問い合わせ"],
  [false,769,"award","賞"],
  [false,770,"strip","細長い一片"],
  [false,771,"distress","苦しみ、悲嘆、苦難"],
  [false,772,"circulation","循環、流通、発行部数"],
  [false,773,"shade","陰、日陰"],
  [false,774,"stereotype","典型的なイメージ、類型、固定観念"],
  [false,775,"client","依頼人"],
  [false,776,"output","生産高"],
  [false,777,"lord","神"],
  [false,778,"convention","慣習、しきたり、会議、大会"],
  [false,779,"mine","鉱山"],
  [false,780,"craft","工芸、技術、巧みに作る"],
  [false,781,"core","中心、核心"],
  [false,782,"stroke","脳卒中、発作、打撃、一撃、なでる"],
  [false,783,"frontier","国境"],
  [false,784,"peer","同僚、じっと見る"],
  [false,785,"vessel","血管、船、器"],
  [true,786,"disability","障害"],
  [false,787,"gravity","重力"],
  [false,788,"ethic","倫理(学)"],
  [false,789,"terminal","終点"],
  [false,790,"tide","潮流、潮の干満"],
  [false,791,"abuse","虐待"],
  [false,792,"guilty","有罪の、罪の意識がある"],
  [false,793,"vital","きわめて重要な、必要な、活気のある"],
  [true,794,"fellow","仲間の"],
  [false,795,"contemporary","現代の"],
  [false,796,"annual","年に１度の、１年間の"],
  [false,797,"accustomed","慣れた"],
  [false,798,"steady","しっかりした"],
  [false,799,"dull","退屈させる"],
  [false,800,"keen","熱望して、鋭い"],
  [false,801,"loose","ゆるい"],
  [false,802,"delicate","繊細な、微妙で難しい"],
  [false,803,"internal","内部の、国内の"],
  [false,804,"casual","形式ばらない、気楽な"],
  [false,805,"mature","成熟した"],
  [false,806,"concrete","具体的な"],
  [false,807,"awful","ひどい"],
  [true,808,"exhausted","疲れ切っている"],
  [false,809,"overall","全面的な、全体的な"],
  [false,810,"tight","引き締まった、きつい"],
  [false,811,"prime","最も重要な、主要な"],
  [false,812,"genuine","本物の、真の、心からの"],
  [false,813,"modest","控えめな、謙虚な、わずかな"],
  [false,814,"intimate","親密な"],
  [false,815,"minimum","最小限の"],
  [false,816,"sophisticated","高度な"],
  [false,817,"latter","後者の"],
  [false,818,"bitter","苦い、つらい、腹を立てた"],
  [false,819,"peculiar","独特の、固有の"],
  [false,820,"passive","受動的な、消極的な"],
  [false,821,"ethnic","民族的な、民族の"],
  [false,822,"noble","高貴な"],
  [false,823,"vain","むだな"],
  [false,824,"innocent","無罪の、罪のない、無邪気な"],
  [false,825,"underlying","根本的な"],
  [true,826,"alien","外国の、異質な"],
  [false,827,"relevant","関連のある"],
  [false,828,"inclined","Ｖする傾向がある、Ｖしたい気がある"],
  [false,829,"awkward","気まずい"],
  [false,830,"brilliant","すばらしい"],
  [false,831,"desperate","必死の"],
  [false,832,"refreshing","さわやかな"],
  [false,833,"thrilled","とてもうれしい"],
  [false,834,"inner","内側の"],
  [false,835,"consistent","矛盾のない、一致した"],
  [true,836,"plain","明白な、わかりやすい"],
  [false,837,"vivid","鮮やかな"],
  [false,838,"miserable","惨めな"],
  [false,839,"substantial","相当な、多大な"],
  [false,840,"fond","Aが好きだ"],
  [true,841,"false","まちがいの"],
  [true,842,"lazy","怠惰な"],
  [false,843,"precisely","正確に、まさに、ちょうど"],
  [false,844,"meanwhile","その間に"],
  [false,845,"altogether","完全に"],
  [false,846,"lately","最近"],
  [false,847,"barely","かろうじて"],
  [false,848,"scarcely","ほとんど～ない"],
  [false,849,"accordingly","それ相応に"],
  [false,850,"deliberately","わざと"],
  [false,851,"beneath","～の下で"],
  [true,852,"whereas","～だが一方"],
  [false,853,"declare","～を宣言する"],
  [false,854,"alter","～を変える"],
  [false,855,"arise","生じる"],
  [false,856,"transform","変える"],
  [false,857,"defeat","～を打ち負かす"],
  [false,858,"investigate","～を調査する"],
  [false,859,"distinguish","～を見分ける"],
  [false,860,"bury","～を埋める"],
  [false,861,"cope","うまく対処する"],
  [false,862,"occur","起こる"],
  [false,863,"accomplish","～をやりとげる"],
  [false,864,"hesitate","ためらう"],
  [false,865,"endure","～に耐える"],
  [false,866,"conclude","～と結論づける"],
  [false,867,"guarantee","～を保証する"],
  [false,868,"dominate","～を支配する"],
  [false,869,"confirm","～を裏付ける"],
  [false,870,"greet","～にあいさつする"],
  [false,871,"entertain","～を楽しませる"],
  [false,872,"defend","～を守る"],
  [false,873,"forbid","～を禁じる"],
  [false,874,"broadcast","～を放送する"],
  [false,875,"sacrifice","～を犠牲にする"],
  [false,876,"punish","～を罰する"],
  [false,877,"glance","ちらりと見る"],
  [false,878,"retain","～を保持する"],
  [false,879,"calculate","～を計算する"],
  [true,880,"sinking","沈む"],
  [false,881,"rescue","～を救助する"],
  [false,882,"beg","～と乞う"],
  [false,883,"define","定義する"],
  [false,884,"deceive","～をだます"],
  [false,885,"convey","～を伝える"],
  [false,886,"sustain","～を維持する"],
  [false,887,"purchase","～を購入する"],
  [false,888,"fade","薄れる"],
  [false,889,"regulate","～を規制する"],
  [false,890,"distribute","～を分配する"],
  [false,891,"enhance","～を向上させる"],
  [false,892,"chat","おしゃべりする"],
  [false,893,"exceed","～を超える"],
  [false,894,"wipe","～をふく"],
  [false,895,"cooperate","協力する"],
  [false,896,"inherit","～を受け継ぐ"],
  [false,897,"unite","～を団結させる"],
  [false,898,"leap","跳ぶ"],
  [false,899,"exaggerate","～を誇張する"],
  [false,900,"conquer","～を征服する"],
  [false,901,"melt","溶ける"],
  [false,902,"invade","～に侵入する"],
  [false,903,"modify","～を修正する"],
  [false,904,"scatter","～をばらまく"],
  [false,905,"undergo","～を経験する"],
  [false,906,"evaluate","～を評価する"],
  [false,907,"bend","身をかがめる"],
  [false,908,"derive","由来する"],
  [true,909,"screaming","悲鳴をあげる"],
  [false,910,"gaze","見つめる"],
  [false,911,"pray","祈る"],
  [false,912,"polish","～を磨く"],
  [false,913,"classify","分類する"],
  [false,914,"assert","～と主張する"],
  [false,915,"grab","～をつかむ"],
  [false,916,"fold","～を折りたたむ"],
  [false,917,"sweep","～を掃く"],
  [false,918,"whisper","ささやく"],
  [false,919,"imitate","～をまねる"],
  [false,920,"stare","じっと見る"],
  [false,921,"emphasize","～を強調する"],
  [true,922,"rid","～を取り除く"],
  [false,923,"pour","～を注ぐ"],
  [false,924,"vanish","消える"],
  [false,925,"restore","～を修復する"],
  [false,926,"deserve","当然だ"],
  [false,927,"laboratory","研究所"],
  [false,928,"conference","会議"],
  [false,929,"continent","大陸"],
  [false,930,"insurance","保険"],
  [false,931,"crew","乗組員たち"],
  [false,932,"poverty","貧乏"],
  [false,933,"shortage","不足"],
  [false,934,"affair","情勢"],
  [false,935,"exception","例外"],
  [false,936,"wage","賃金"],
  [false,937,"wisdom","知恵"],
  [false,938,"tax","税金"],
  [false,939,"evolution","進化"],
  [false,940,"barrier","壁"],
  [false,941,"category","範ちゅう"],
  [false,942,"unit","単位"],
  [true,943,"reputation","評判"],
  [false,944,"virtue","美徳"],
  [false,945,"courage","勇気"],
  [false,946,"sympathy","同情"],
  [false,947,"union","組合"],
  [false,948,"civilization","文明"],
  [false,949,"volume","冊"],
  [false,950,"blossom","花"],
  [false,951,"era","時代"],
  [false,952,"dispute","紛争"],
  [false,953,"tourism","観光"],
  [false,954,"mankind","人類"],
  [false,955,"murder","殺人"],
  [false,956,"landscape","風景"],
  [false,957,"destination","目的地"],
  [false,958,"tale","話"],
  [false,959,"reform","改革"],
  [false,960,"muscle","筋肉"],
  [false,961,"prospect","見通し"],
  [false,962,"corporation","企業"],
  [false,963,"colony","植民地"],
  [false,964,"quarrel","口論"],
  [false,965,"profession","職業"],
  [false,966,"aspect","側面"],
  [false,967,"pause","休止"],
  [false,968,"conflict","対立"],
  [false,969,"privilege","特権"],
  [false,970,"prosperity","繁栄"],
  [false,971,"genius","天才"],
  [false,972,"seed","種"],
  [false,973,"symptom","症状"],
  [false,974,"merit","長所"],
  [false,975,"layer","層"],
  [false,976,"clue","手がかり"],
  [false,977,"circumstances","状況"],
  [false,978,"district","地区"],
  [false,979,"prison","刑務所"],
  [false,980,"companion","仲間"],
  [false,981,"executive","重役"],
  [false,982,"justice","正義"],
  [false,983,"procedure","手続き"],
  [false,984,"ray","光線"],
  [false,985,"heaven","天国"],
  [false,986,"luxury","贅沢"],
  [false,987,"oxygen","酸素"],
  [false,988,"fund","資金"],
  [false,989,"theme","主題、テーマ"],
  [false,990,"boundary","境界"],
  [false,991,"ambition","熱望"],
  [false,992,"forecast","予報"],
  [true,993,"psychology","心理学"],
  [false,994,"labor","労働"],
  [false,995,"committee","委員会"],
  [false,996,"physician","医者"],
  [false,997,"philosophy","哲学"],
  [false,998,"affection","愛情"],
  [false,999,"candidate","候補"],
  [false,1000,"bomb","爆弾"],
  [false,1001,"priority","優先"],
  [false,1002,"obstacle","障害"],
  [false,1003,"appetite","食欲"],
  [false,1004,"tension","緊張"],
  [false,1005,"tribe","部族"],
  [false,1006,"budget","予算"],
  [false,1007,"campaign","運動、キャンペーン"],
  [false,1008,"sorrow","悲しみ"],
  [false,1009,"satellite","衛星"],
  [false,1010,"insight","洞察"],
  [false,1011,"cough","せき"],
  [false,1012,"fate","運命"],
  [false,1013,"scheme","計画"],
  [false,1014,"insult","侮辱"],
  [false,1015,"inhabitant","住民"],
  [false,1016,"fossil","化石"],
  [false,1017,"motive","動機"],
  [false,1018,"instinct","本能"],
  [false,1019,"legend","伝説"],
  [false,1020,"empire","帝国"],
  [false,1021,"suburb","郊外"],
  [false,1022,"architecture","建築"],
  [false,1023,"passion","情熱"],
  [false,1024,"cancer","ガン"],
  [false,1025,"logic","論理"],
  [false,1026,"dozen","ダース"],
  [false,1027,"harvest","収穫"],
  [false,1028,"ingredient","材料"],
  [false,1029,"hypothesis","仮説"],
  [false,1030,"voyage","航海"],
  [false,1031,"editor","編集者"],
  [false,1032,"option","選択の自由"],
  [true,1033,"hemisphere","半球"],
  [false,1034,"mechanism","仕組み"],
  [false,1035,"anthropologist","人類学者"],
  [false,1036,"tragedy","悲劇"],
  [true,1037,"antibiotic","抗生物質"],
  [false,1038,"fare","運賃"],
  [false,1039,"debt","借金"],
  [true,1040,"curriculum","教育課程"],
  [false,1041,"component","構成要素"],
  [false,1042,"wheat","小麦"],
  [false,1043,"usage","語法"],
  [false,1044,"castle","城"],
  [false,1045,"famine","飢饉"],
  [false,1046,"extinction","絶滅"],
  [false,1047,"purse","財布"],
  [false,1048,"folk","民族"],
  [false,1049,"explosion","爆発"],
  [false,1050,"portion","部分"],
  [false,1051,"organism","生物"],
  [false,1052,"merchant","商人"],
  [false,1053,"myth","神話"],
  [false,1054,"incident","出来事"],
  [false,1055,"wildlife","野生生物"],
  [false,1056,"congress","議会"],
  [false,1057,"bay","湾"],
  [false,1058,"penalty","刑"],
  [false,1059,"heritage","遺産"],
  [false,1060,"diversity","多様性"],
  [false,1061,"thumb","親指"],
  [true,1062,"geography","地理"],
  [false,1063,"factor","要因"],
  [false,1064,"discrimination","差別"],
  [false,1065,"virus","ウイルス"],
  [false,1066,"statue","像"],
  [false,1067,"priest","神父"],
  [false,1068,"pioneer","先駆者"],
  [false,1069,"trait","特徴"],
  [false,1070,"bond","きずな"],
  [false,1071,"grocery","食料品"],
  [true,1072,"secretary","秘書"],
  [false,1073,"dialect","方言"],
  [true,1074,"astronomy","天文学"],
  [false,1075,"youngster","子供"],
  [false,1076,"substance","物質"],
  [false,1077,"finding","発見"],
  [false,1078,"strategy","戦略"],
  [false,1079,"lung","肺"],
  [false,1080,"opponent","敵"],
  [false,1081,"ritual","儀式"],
  [false,1082,"outcome","結果"],
  [false,1083,"conservation","環境保護"],
  [false,1084,"mammal","哺乳類"],
  [false,1085,"telescope","望遠鏡"],
  [false,1086,"refugee","難民"],
  [false,1087,"code","規則"],
  [false,1088,"flavor","風味"],
  [false,1089,"particle","粒子"],
  [false,1090,"nursing","看護"],
  [false,1091,"suicide","自殺"],
  [false,1092,"habitat","生息地"],
  [false,1093,"bullying","いじめ"],
  [false,1094,"dinosaur","恐竜"],
  [false,1095,"council","議会"],
  [false,1096,"gender","性別"],
  [false,1097,"surgery","手術"],
  [false,1098,"innovation","革新"],
  [false,1099,"protein","タンパク質"],
  [false,1100,"nutrition","栄養"],
  [false,1101,"disaster","災害"],
  [false,1102,"emission","排出"],
  [false,1103,"ape","類人猿"],
  [false,1104,"molecule","分子"],
  [false,1105,"sweat","汗"],
  [false,1106,"transplant","移植"],
  [false,1107,"species","種"],
  [false,1108,"tip","先"],
  [false,1109,"cattle","牛"],
  [true,1110,"density","密度"],
  [false,1111,"concept","概念"],
  [true,1112,"pale","青白い"],
  [false,1113,"precious","貴重な"],
  [false,1114,"loyal","忠実な"],
  [false,1115,"isolated","孤立している"],
  [false,1116,"generous","気前のよい"],
  [false,1117,"tropical","熱帯"],
  [false,1118,"reluctant","したがらない"],
  [false,1119,"vague","漠然とした"],
  [false,1120,"vast","広大な"],
  [false,1121,"numerous","たくさんの"],
  [false,1122,"rural","田舎の"],
  [false,1123,"widespread","広まっている"],
  [false,1124,"complicated","複雑な"],
  [false,1125,"visible","目に見える"],
  [false,1126,"raw","生の"],
  [false,1127,"remote","へんぴな"],
  [false,1128,"urgent","緊急の"],
  [false,1129,"silly","ばかな"],
  [false,1130,"striking","いちじるしい"],
  [false,1131,"adequate","十分な"],
  [false,1132,"extraordinary","並外れた"],
  [false,1133,"odd","おかしな"],
  [false,1134,"abstract","抽象的な"],
  [false,1135,"mutual","相互の"],
  [false,1136,"excessive","過度の"],
  [false,1137,"ashamed","恥ずかしい"],
  [false,1138,"tremendous","とてつもない"],
  [false,1139,"inevitable","避けられない"],
  [false,1140,"pure","純"],
  [false,1141,"stable","安定した"],
  [false,1142,"indifferent","無関心だ"],
  [false,1143,"aggressive","攻撃的な"],
  [false,1144,"ultimate","究極の"],
  [false,1145,"shy","内気な"],
  [false,1146,"solar","太陽"],
  [false,1147,"profound","深い"],
  [false,1148,"subtle","微妙な"],
  [false,1149,"conservative","保守"],
  [false,1150,"brave","勇敢な"],
  [false,1151,"intense","強烈な"],
  [true,1152,"alcoholic","アルコールの"],
  [false,1153,"manual","手を使う"],
  [false,1154,"cruel","残酷な"],
  [false,1155,"rational","理性的な"],
  [false,1156,"initial","最初の"],
  [true,1157,"immune","免疫"],
  [false,1158,"linguistic","言語の"],
  [false,1159,"crucial","重大な"],
  [false,1160,"verbal","言葉による"],
  [false,1161,"optimistic","楽観的な"],
  [false,1162,"flexible","柔軟な"],
  [false,1163,"grateful","感謝している"],
  [false,1164,"lively","生き生きとした"],
  [false,1165,"overwhelming","圧倒的な"],
  [true,1166,"abundant","豊富な"],
  [false,1167,"selfish","利己的な"],
  [false,1168,"ugly","みにくい"],
  [false,1169,"racial","人種の"],
  [false,1170,"prominent","有名な"],
  [true,1171,"controversial","物議を呼ぶ"],
  [false,1172,"federal","連邦の"],
  [false,1173,"ridiculous","ばかげた"],
  [false,1174,"imaginary","架空の"],
  [false,1175,"harsh","厳しい"],
  [false,1176,"random","無作為な"],
  [true,1177,"adolescent","思春期の"],
  [false,1178,"up-to-date","最新の"],
  [false,1179,"liberal","自由主義の"],
  [false,1180,"prior","前の"],
  [false,1181,"moderate","適度な"],
  [false,1182,"fluent","流ちょうな"],
  [false,1183,"elaborate","手の込んだ"],
  [false,1184,"incredible","信じられない"],
  [false,1185,"radical","根本的な"],
  [false,1186,"acid","酸性の"],
  [false,1187,"deaf","耳が不自由な"],
  [false,1188,"medieval","中世の"],
  [false,1189,"ecological","生態"],
  [false,1190,"slight","少しの"],
  [false,1191,"ignorant","無知な"],
  [false,1192,"cognitive","認知"],
  [false,1193,"absolutely","絶対に"],
  [false,1194,"virtually","ほとんど"],
  [false,1195,"somewhat","多少"],
  [false,1196,"merely","単に"],
  [false,1197,"literally","文字通り"],
  [false,1198,"seemingly","一見"],
  [false,1199,"regardless","関係なく"],
  [true,1200,"thoroughly","徹底的に"],
  [false,1201,"submit","Aに服従する、提出する"],
  [false,1202,"tempt","誘惑する、する気にさせる"],
  [false,1203,"resign","辞職する"],
  [false,1204,"conform","従う"],
  [false,1205,"confine","限定する"],
  [false,1206,"assemble","組み立てる"],
  [false,1207,"dedicate","ささげる"],
  [false,1208,"advocate","主張する"],
  [false,1209,"thrive","繁栄する"],
  [false,1210,"provoke","引き起こす"],
  [false,1211,"dictate","命じる、要求する、決定する"],
  [false,1212,"exploit","利用する、開発する"],
  [false,1213,"surrender","降伏する"],
  [false,1214,"reproduce","再生する、複製する、繁殖する[させる]"],
  [false,1215,"acknowledge","認める"],
  [false,1216,"swell","ふくらむ"],
  [false,1217,"shed","落とす"],
  [false,1218,"wind","曲がる"],
  [false,1219,"cite","引き合いに出す"],
  [false,1220,"digest","消化する"],
  [false,1221,"skip","とばす、抜かす"],
  [false,1222,"bind","縛る、束縛する"],
  [false,1223,"dissolve","溶解する"],
  [false,1224,"implement","実行する"],
  [false,1225,"steer","操縦する"],
  [false,1226,"congratulate","祝福する"],
  [false,1227,"designate","指定する"],
  [false,1228,"violate","破る、違反する"],
  [false,1229,"presume","推定する、思う"],
  [false,1230,"recruit","（新人を）入れる"],
  [false,1231,"coincide","同時に起きる、重なる"],
  [false,1232,"enforce","施行する"],
  [false,1233,"displace","とってかわる、故郷から追い出す"],
  [false,1234,"shrink","縮む、縮ませる、減る"],
  [false,1235,"betray","裏切る、もらす"],
  [false,1236,"comprise","構成される、構成する、占める"],
  [false,1237,"indulge","ふける"],
  [false,1238,"penetrate","入り込む"],
  [false,1239,"devastate","壊滅させる"],
  [false,1240,"plunge","突っ込む"],
  [true,1241,"bounce","はね返る"],
  [false,1242,"contradict","矛盾する"],
  [false,1243,"prescribe","処方する"],
  [false,1244,"oppress","しいたげる"],
  [false,1245,"cherish","胸に抱く"],
  [false,1246,"illuminate","照らす、解明する"],
  [false,1247,"trigger","きっかけになる"],
  [false,1248,"commute","通勤する、通学する"],
  [false,1249,"induce","誘う"],
  [false,1250,"utilize","利用する"],
  [false,1251,"snap","ポキンと折れる、ポキンと折る"],
  [false,1252,"donate","提供する"],
  [false,1253,"hatch","（卵・ヒナ）かえす、かえる"],
  [false,1254,"enclose","囲む"],
  [false,1255,"prevail","普及している、広まる"],
  [false,1256,"sigh","ため息をつく"],
  [false,1257,"leak","漏れる、漏らす"],
  [false,1258,"compel","強制する"],
  [false,1259,"crush","押しつぶす"],
  [false,1260,"comprehend","理解する"],
  [false,1261,"negotiate","交渉する"],
  [false,1262,"persist","持続する、残る"],
  [false,1263,"multiply","増やす、増える、掛ける"],
  [false,1264,"conceive","想像する"],
  [false,1265,"compensate","埋め合わせる"],
  [false,1266,"suspend","中止する、つるす"],
  [false,1267,"stir","かきたてる"],
  [false,1268,"soak","浸す、びしょぬれにする、吸収する"],
  [false,1269,"refine","洗練する、磨きをかける"],
  [false,1270,"arouse","刺激する、かき立てる"],
  [false,1271,"precede","先行する"],
  [false,1272,"render","OをCにする、変える"],
  [false,1273,"mount","すえつける、乗る"],
  [false,1274,"retreat","退く"],
  [false,1275,"startle","驚かせる"],
  [true,1276,"dare","する勇気がある"],
  [false,1277,"sphere","領域、範囲"],
  [false,1278,"sequence","連続、順番、順序"],
  [false,1279,"deposit","預金、頭金、堆積物"],
  [false,1280,"poll","世論調査、投票"],
  [false,1281,"caution","用心"],
  [false,1282,"rage","激怒、怒り"],
  [false,1283,"formula","式、公式、方法、秘訣、解決策"],
  [false,1284,"plot","筋、たくらみ、陰謀"],
  [false,1285,"scope","範囲"],
  [false,1286,"norm","規範"],
  [false,1287,"disgust","嫌悪"],
  [false,1288,"compromise","妥協"],
  [false,1289,"supervisor","監督者"],
  [false,1290,"paradox","逆説"],
  [false,1291,"tissue","（生物の）組織；ティッシュペーパー"],
  [false,1292,"breakdown","崩壊"],
  [false,1293,"initiative","構想、主導権"],
  [false,1294,"fabric","織物、布"],
  [false,1295,"publicity","宣伝、広告"],
  [false,1296,"summit","頂上、頂点、首脳会議"],
  [false,1297,"flock","群れ"],
  [false,1298,"plague","疫病"],
  [false,1299,"haste","急ぐこと"],
  [false,1300,"nap","うたた寝"],
  [false,1301,"ally","同盟国"],
  [false,1302,"draft","下書き、草稿"],
  [false,1303,"spectacle","光景"],
  [false,1304,"premise","前提"],
  [false,1305,"asset","財産"],
  [false,1306,"lag","遅れ"],
  [false,1307,"therapy","療法、治療法"],
  [false,1308,"reception","もてなし"],
  [false,1309,"compound","化合物"],
  [false,1310,"blessing","ありがたいもの、恵み"],
  [false,1311,"sensation","感覚、感じ"],
  [false,1312,"recession","不景気、不況"],
  [true,1313,"pole","棒、極"],
  [false,1314,"outlook","態度、考え方、見通し、見込み"],
  [false,1315,"endeavor","活動"],
  [false,1316,"mercy","慈悲、情け"],
  [false,1317,"counterpart","相当するもの"],
  [true,1318,"session","期間、討論"],
  [true,1319,"spectrum","変動範囲、領域"],
  [true,1320,"junk","くず、がらくた"],
  [false,1321,"worship","崇拝"],
  [false,1322,"apt","しがちである、する傾向がある"],
  [false,1323,"humble","謙虚な、粗末な"],
  [false,1324,"entitled","得る権利がある、題された"],
  [false,1325,"valid","妥当な、正当な"],
  [false,1326,"faint","かすかな"],
  [false,1327,"stiff","堅い"],
  [false,1328,"obscure","わかりにくい"],
  [false,1329,"fierce","激しい"],
  [false,1330,"acute","（問題が）深刻な、（感覚・痛みが）鋭い"],
  [false,1331,"idle","（仕事がなくて）何もしていない"],
  [false,1332,"crude","粗末な、粗野な"],
  [false,1333,"jealous","嫉妬深い、羨ましい"],
  [false,1334,"pregnant","妊娠している"],
  [false,1335,"liable","しがちである、可能性が高い"],
  [false,1336,"stubborn","頑固な"],
  [false,1337,"decent","まともな"],
  [false,1338,"marvelous","驚くべき"],
  [false,1339,"misleading","誤解を招く"],
  [false,1340,"synthetic","合成の"],
  [false,1341,"classical","クラシックの"],
  [false,1342,"Muslim","イスラム教の"],
  [false,1343,"anticipate","予想する"],
  [false,1344,"rub","こする"],
  [false,1345,"dispose","処理する"],
  [false,1346,"refrain","控える"],
  [false,1347,"accumulate","蓄積する"],
  [true,1348,"boost","活気づける"],
  [false,1349,"drag","引きずる"],
  [false,1350,"revise","修正する"],
  [false,1351,"scratch","かく"],
  [false,1352,"roar","ほえる"],
  [false,1353,"quote","引用する"],
  [false,1354,"bloom","咲く"],
  [false,1355,"insert","差し込む"],
  [true,1356,"awaiting","待つ"],
  [false,1357,"dread","恐れる"],
  [false,1358,"conceal","隠す"],
  [false,1359,"enrich","豊かにする"],
  [false,1360,"cling","固執する"],
  [false,1361,"surpass","まさる"],
  [false,1362,"suppress","抑える"],
  [false,1363,"portray","描く"],
  [true,1364,"soaring","急上昇する"],
  [false,1365,"drain","排出する"],
  [false,1366,"glow","ボーッと光る"],
  [false,1367,"migrate","移住する"],
  [false,1368,"exclaim","叫ぶ"],
  [false,1369,"exert","及ぼす"],
  [false,1370,"disguise","隠す"],
  [false,1371,"accelerate","加速する"],
  [false,1372,"dwell","住む"],
  [false,1373,"integrate","融けこませる"],
  [false,1374,"weep","泣く"],
  [false,1375,"reassure","安心させる"],
  [false,1376,"crawl","はって進む"],
  [false,1377,"restrain","抑制する"],
  [false,1378,"resent","腹を立てる"],
  [false,1379,"yell","大声で叫ぶ"],
  [false,1380,"assess","評価する"],
  [false,1381,"carve","彫る"],
  [false,1382,"halt","止める"],
  [false,1383,"inspect","検査する"],
  [false,1384,"tackle","取り組む"],
  [false,1385,"omit","省く"],
  [false,1386,"chew","かむ"],
  [false,1387,"resume","再開する"],
  [false,1388,"mold","作る"],
  [false,1389,"accommodate","収容できる"],
  [false,1390,"erase","消す"],
  [true,1391,"inferred","推量する"],
  [false,1392,"revive","生き返らせる"],
  [false,1393,"contemplate","考える"],
  [false,1394,"rotate","回転する"],
  [false,1395,"disrupt","かき乱す"],
  [false,1396,"navigate","進路を決める"],
  [true,1397,"ache","痛む"],
  [false,1398,"discard","捨てる"],
  [false,1399,"incorporate","取り入れる"],
  [false,1400,"overtake","追い越す"],
  [false,1401,"supplement","補う"],
  [false,1402,"manipulate","操作する"],
  [false,1403,"nourish","養う"],
  [false,1404,"squeeze","しぼる"],
  [false,1405,"depict","描く"],
  [false,1406,"distract","そらす"],
  [false,1407,"disclose","暴露する"],
  [false,1408,"enroll","入学する"],
  [false,1409,"nurture","育てる"],
  [false,1410,"speculate","推測する"],
  [false,1411,"prolong","延ばす"],
  [false,1412,"execute","処刑する"],
  [false,1413,"uncover","明らかにする"],
  [false,1414,"tremble","震える"],
  [false,1415,"seize","つかむ"],
  [false,1416,"abolish","廃止する"],
  [false,1417,"scold","しかる"],
  [false,1418,"attain","達成する"],
  [false,1419,"utter","発する"],
  [false,1420,"flee","逃げる"],
  [true,1421,"offending","怒らせる"],
  [false,1422,"confess","告白する"],
  [false,1423,"postpone","延期する"],
  [false,1424,"drift","漂う"],
  [false,1425,"weave","織る"],
  [false,1426,"install","備えつける"],
  [false,1427,"twist","ねじ曲げる"],
  [false,1428,"extract","取り出す"],
  [false,1429,"bump","ぶつかる"],
  [false,1430,"despise","軽蔑する"],
  [false,1431,"tolerate","我慢する"],
  [false,1432,"boast","自慢する"],
  [true,1433,"flourishing","栄えている"],
  [false,1434,"disregard","無視する"],
  [false,1435,"tease","からかう"],
  [false,1436,"reinforce","強める"],
  [false,1437,"strive","努力する"],
  [false,1438,"coordinate","合わせる"],
  [false,1439,"yawn","あくびをする"],
  [true,1440,"hug","抱きしめる"],
  [true,1441,"combat","戦う"],
  [false,1442,"knit","編む"],
  [false,1443,"fatigue","疲労"],
  [false,1444,"fame","名声"],
  [false,1445,"mess","めちゃくちゃ"],
  [false,1446,"dignity","尊厳"],
  [false,1447,"canal","運河"],
  [false,1448,"drought","干ばつ"],
  [false,1449,"despair","絶望"],
  [false,1450,"interval","間隔"],
  [false,1451,"luggage","荷物"],
  [true,1452,"behalf","代表して"],
  [false,1453,"impulse","衝動"],
  [true,1454,"debris","破片"],
  [false,1455,"beast","野獣"],
  [false,1456,"superstition","迷信"],
  [false,1457,"illusion","幻想、錯覚"],
  [false,1458,"thread","糸"],
  [false,1459,"intake","摂取量"],
  [false,1460,"feast","宴会"],
  [false,1461,"transition","移り変わり"],
  [false,1462,"misery","悲惨さ"],
  [false,1463,"radiation","放射線"],
  [false,1464,"log","丸太"],
  [false,1465,"consensus","合意"],
  [false,1466,"deed","行い"],
  [false,1467,"proverb","ことわざ"],
  [false,1468,"compliment","ほめ言葉"],
  [false,1469,"flame","炎"],
  [false,1470,"anniversary","記念日"],
  [false,1471,"conscience","良心"],
  [false,1472,"expedition","探検"],
  [false,1473,"offspring","子孫"],
  [false,1474,"allowance","こづかい"],
  [false,1475,"headline","大見出し"],
  [false,1476,"treaty","条約"],
  [false,1477,"monument","記念碑"],
  [false,1478,"worm","虫"],
  [false,1479,"remedy","治療法"],
  [false,1480,"encyclopedia","百科事典"],
  [false,1481,"glimpse","ちらり"],
  [false,1482,"personnel","職員"],
  [false,1483,"triumph","勝利"],
  [false,1484,"arithmetic","算数"],
  [false,1485,"self-esteem","自尊心"],
  [true,1486,"microbe","微生物"],
  [false,1487,"odds","可能性"],
  [false,1488,"chaos","混沌"],
  [false,1489,"destiny","運命"],
  [false,1490,"diameter","直径"],
  [false,1491,"lottery","宝くじ"],
  [false,1492,"souvenir","みやげ物"],
  [false,1493,"trail","小道"],
  [false,1494,"ratio","比率"],
  [false,1495,"sword","剣"],
  [false,1496,"whistle","笛"],
  [false,1497,"sentiment","感情"],
  [false,1498,"chore","雑用"],
  [false,1499,"courtesy","礼儀"],
  [false,1500,"mayor","市長"],
  [true,1501,"surveillance","監視、見張り"],
  [false,1502,"trash","ごみ"],
  [false,1503,"prestige","名声"],
  [false,1504,"headquarters","本部、本社"],
  [false,1505,"wilderness","荒野"],
  [false,1506,"orbit","軌道"],
  [false,1507,"bias","偏見"],
  [false,1508,"republic","共和国"],
  [false,1509,"bargain","掘り出し物"],
  [false,1510,"domain","領域"],
  [false,1511,"fragment","破片"],
  [false,1512,"galaxy","星雲"],
  [false,1513,"lap","ひざ"],
  [true,1514,"deadline","締め切り"],
  [false,1515,"bullet","弾丸"],
  [false,1516,"pedestrian","歩行者"],
  [false,1517,"wit","機知"],
  [false,1518,"nuisance","迷惑"],
  [false,1519,"criteria","基準"],
  [false,1520,"hardship","苦難"],
  [false,1521,"glory","栄光"],
  [false,1522,"pavement","歩道"],
  [false,1523,"navy","海軍"],
  [false,1524,"script","台本"],
  [false,1525,"pension","年金"],
  [false,1526,"province","州"],
  [false,1527,"surplus","余剰"],
  [false,1528,"moisture","水分"],
  [true,1529,"patch","あて布"],
  [false,1530,"altitude","高度、標高"],
  [false,1531,"thermometer","温度計"],
  [false,1532,"tuition","授業料"],
  [false,1533,"troop","軍隊"],
  [false,1534,"primate","霊長類"],
  [false,1535,"flaw","欠陥"],
  [false,1536,"nephew","甥"],
  [false,1537,"garment","衣服、衣類"],
  [false,1538,"diagnosis","診断"],
  [false,1539,"commerce","商業"],
  [false,1540,"antiquity","古代、古物"],
  [false,1541,"fraction","ほんの一部"],
  [false,1542,"irony","皮肉"],
  [false,1543,"nightmare","悪夢"],
  [false,1544,"defect","欠陥"],
  [false,1545,"certificate","証明書"],
  [false,1546,"decay","腐敗"],
  [false,1547,"erosion","浸食"],
  [false,1548,"recipe","秘けつ"],
  [false,1549,"skeleton","骨格"],
  [false,1550,"grace","優雅さ"],
  [false,1551,"landmark","名所"],
  [true,1552,"dementia","認知症"],
  [false,1553,"flesh","肉"],
  [false,1554,"collision","衝突、対立"],
  [false,1555,"hazard","危険なもの"],
  [false,1556,"tomb","墓"],
  [true,1557,"injection","注射"],
  [false,1558,"breakthrough","飛躍的進歩"],
  [false,1559,"leather","革"],
  [false,1560,"jewelry","宝石"],
  [false,1561,"cue","合図"],
  [false,1562,"ambulance","救急車"],
  [false,1563,"estate","不動産"],
  [false,1564,"commodity","商品"],
  [false,1565,"departure","出発"],
  [false,1566,"phase","段階"],
  [false,1567,"thief","泥棒"],
  [false,1568,"saint","聖"],
  [false,1569,"sculpture","彫刻"],
  [false,1570,"grief","悲しみ"],
  [false,1571,"lane","車線"],
  [false,1572,"predator","捕食動物"],
  [false,1573,"fluid","流体"],
  [false,1574,"incentive","はげみ"],
  [false,1575,"bride","花嫁"],
  [false,1576,"intervention","介入"],
  [false,1577,"margin","差"],
  [false,1578,"biography","伝記"],
  [false,1579,"consent","同意"],
  [false,1580,"volcano","火山"],
  [false,1581,"rebel","反逆者"],
  [false,1582,"metaphor","比喩"],
  [false,1583,"legislation","法律"],
  [false,1584,"lightning","雷"],
  [false,1585,"pesticide","殺虫剤"],
  [false,1586,"column","コラム"],
  [false,1587,"rumor","うわさ"],
  [false,1588,"dust","ほこり"],
  [false,1589,"dialogue","対話"],
  [false,1590,"kindergarten","幼稚園"],
  [true,1591,"diabetes","糖尿病"],
  [false,1592,"obesity","肥満"],
  [false,1593,"patent","特許"],
  [false,1594,"chapter","章"],
  [false,1595,"palace","宮殿"],
  [false,1596,"laundry","洗濯"],
  [false,1597,"ward","病棟"],
  [false,1598,"outbreak","ぼっ発"],
  [false,1599,"equation","方程式"],
  [false,1600,"archaeologist","考古学者"],
  [false,1601,"corruption","腐敗"],
  [false,1602,"germ","細菌"],
  [false,1603,"revenue","収入"],
  [false,1604,"spouse","配偶者"],
  [false,1605,"epidemic","流行"],
  [false,1606,"mortality","死亡"],
  [false,1607,"syndrome","症候群"],
  [false,1608,"retail","小売り"],
  [false,1609,"dose","量"],
  [false,1610,"beverage","飲み物"],
  [false,1611,"metabolism","新陳代謝"],
  [false,1612,"hybrid","交配種"],
  [false,1613,"scent","香り"],
  [true,1614,"inflammation","炎症"],
  [true,1615,"pill","薬"],
  [false,1616,"grave","重大な"],
  [false,1617,"fertile","肥えた"],
  [false,1618,"hostile","反感を持つ"],
  [false,1619,"indispensable","不可欠な"],
  [false,1620,"oriented","志向の"],
  [false,1621,"splendid","すばらしい"],
  [false,1622,"competent","有能な"],
  [false,1623,"supreme","最高の"],
  [false,1624,"straightforward","わかりやすい"],
  [false,1625,"sacred","聖"],
  [false,1626,"bold","大胆な"],
  [false,1627,"uneasy","不安な"],
  [false,1628,"neat","きちんとした"],
  [false,1629,"shallow","浅い"],
  [false,1630,"fake","偽物の"],
  [false,1631,"superficial","表面的な"],
  [false,1632,"absurd","ばかげた"],
  [false,1633,"fragile","壊れやすい"],
  [false,1634,"respectable","ちゃんとした"],
  [false,1635,"magnificent","すばらしい"],
  [false,1636,"infinite","無限の"],
  [false,1637,"comprehensive","包括的な"],
  [false,1638,"steep","険しい"],
  [false,1639,"gross","総"],
  [false,1640,"subsequent","次に起こる"],
  [false,1641,"sincere","心からの"],
  [false,1642,"toxic","有毒な"],
  [false,1643,"neutral","中立の"],
  [false,1644,"diligent","勤勉な"],
  [false,1645,"sore","痛い"],
  [false,1646,"contaminated","汚染された"],
  [false,1647,"ambiguous","あいまいな"],
  [false,1648,"oral","口述の"],
  [false,1649,"restless","落ち着かない"],
  [true,1650,"rotten","腐った"],
  [false,1651,"vigorous","精力的な"],
  [false,1652,"immense","莫大な"],
  [false,1653,"metropolitan","大都市の"],
  [false,1654,"punctual","時間をきっちり守る"],
  [false,1655,"solitary","孤独な"],
  [false,1656,"collective","集団"],
  [false,1657,"diplomatic","外交の"],
  [false,1658,"nasty","不快な"],
  [false,1659,"helpless","無力な"],
  [false,1660,"explicit","明確な、はっきりした"],
  [false,1661,"bankrupt","破産した"],
  [false,1662,"eternal","永遠の"],
  [false,1663,"sole","唯一の"],
  [false,1664,"sour","すっぱい"],
  [false,1665,"notable","注目すべき"],
  [false,1666,"affluent","裕福な"],
  [false,1667,"naked","裸の"],
  [false,1668,"vocal","発声"],
  [false,1669,"feminine","女性の"],
  [false,1670,"vacant","空いている"],
  [false,1671,"exotic","外来の"],
  [false,1672,"rigid","厳格な"],
  [false,1673,"humid","蒸し暑い"],
  [false,1674,"outstanding","傑出した"],
  [false,1675,"addicted","中毒である"],
  [false,1676,"vulnerable","受けやすい"],
  [false,1677,"spontaneous","自然に起こる"],
  [false,1678,"greedy","貪欲な"],
  [false,1679,"trivial","ささいな"],
  [false,1680,"per capita","一人当たりの"],
  [false,1681,"inherent","元から伴う"],
  [false,1682,"promising","前途有望な"],
  [false,1683,"physiological","生理的な"],
  [false,1684,"clinical","臨床"],
  [false,1685,"chronic","慢性の"],
  [false,1686,"geological","地質学的な"],
  [false,1687,"countless","無数の"],
  [false,1688,"innate","先天的な"],
  [false,1689,"alert","用心する"],
  [true,1690,"autonomous","自動運転"],
  [false,1691,"simultaneously","同時に"],
  [false,1692,"utterly","まったく"],
  [false,1693,"drastically","劇的に"],
  [false,1694,"necessarily","必ずしも"],
  [false,1695,"thereby","そうすることで"],
  [false,1696,"frankly","率直に"],
  [false,1697,"namely","すなわち"],
  [false,1698,"hence","だから"],
  [false,1699,"via","経由で"],
  [true,1700,"owing","のために"],
  [false,1701,"clarify","明らかにする"],
  [false,1702,"smash","粉々に砕く"],
  [false,1703,"mourn","悲しむ"],
  [false,1704,"summon","呼ぶ"],
  [false,1705,"shatter","粉々にする"],
  [false,1706,"linger","残る"],
  [false,1707,"lament","嘆く"],
  [true,1708,"endowed","恵まれる"],
  [false,1709,"rejoice","喜ぶ"],
  [true,1710,"allocate","配分する"],
  [false,1711,"slap","ピシャリと打つ"],
  [false,1712,"contend","主張する"],
  [false,1713,"swear","誓う"],
  [false,1714,"discern","識別する"],
  [false,1715,"degrade","悪化させる"],
  [false,1716,"erect","築く"],
  [false,1717,"testify","証言する"],
  [false,1718,"spur","駆りたてる"],
  [false,1719,"roam","歩き回る"],
  [false,1720,"frown","まゆをひそめる"],
  [false,1721,"lure","呼び込む"],
  [false,1722,"defy","逆らう"],
  [false,1723,"stroll","ぶらつく"],
  [false,1724,"rattle","がたがた鳴らす"],
  [false,1725,"reconcile","調和させる"],
  [false,1726,"blur","ぼやかす"],
  [false,1727,"soothe","なだめる"],
  [false,1728,"impair","低下させる"],
  [false,1729,"comply","従う"],
  [false,1730,"pierce","穴をあける"],
  [false,1731,"stumble","つまずく"],
  [false,1732,"hinder","さまたげる"],
  [false,1733,"mock","あざける"],
  [false,1734,"embody","具現する"],
  [false,1735,"stalk","忍び寄る"],
  [false,1736,"proclaim","宣言する"],
  [false,1737,"applaud","拍手する"],
  [false,1738,"inflict","与える"],
  [false,1739,"merge","合併する"],
  [true,1740,"evacuated","避難した"],
  [false,1741,"undone","元に戻る"],
  [false,1742,"poke","突く"],
  [true,1743,"haunted","つきまとわれる"],
  [false,1744,"adhere","固く守る"],
  [false,1745,"compile","まとめる"],
  [false,1746,"wither","しぼむ"],
  [false,1747,"stun","びっくりさせる"],
  [false,1748,"choke","のどがつまる"],
  [false,1749,"deteriorate","悪化する"],
  [true,1750,"dump","捨てる"],
  [false,1751,"murmur","つぶやく"],
  [true,1752,"delete","削除する"],
  [true,1753,"inhibit","阻害する"],
  [false,1754,"divert","そらす"],
  [false,1755,"tame","飼いならす"],
  [false,1756,"reap","手に入れる"],
  [false,1757,"affirm","断言する"],
  [true,1758,"immersed","浸る"],
  [true,1759,"expire","期限が切れる"],
  [false,1760,"embark","乗り出す"],
  [false,1761,"vow","誓う"],
  [false,1762,"foresee","予知する"],
  [false,1763,"adore","崇拝する"],
  [false,1764,"yearn","切望する"],
  [false,1765,"undermine","弱める"],
  [false,1766,"suck","吸う"],
  [false,1767,"pledge","誓う"],
  [false,1768,"intrude","立ち入る"],
  [false,1769,"sue","訴える"],
  [false,1770,"distort","歪曲する"],
  [false,1771,"extinguish","消す"],
  [false,1772,"preach","説教する"],
  [false,1773,"curb","抑制する"],
  [false,1774,"withstand","耐える"],
  [true,1775,"dip","浸す"],
  [false,1776,"recite","暗唱する"],
  [false,1777,"thrust","押し込む"],
  [false,1778,"plead","嘆願する"],
  [false,1779,"humiliate","恥をかかせる"],
  [false,1780,"discharge","放出する"],
  [false,1781,"condemn","非難する"],
  [false,1782,"retrieve","検索する"],
  [false,1783,"shrug","肩をすくめる"],
  [false,1784,"evoke","呼び起こす"],
  [false,1785,"fetch","取ってくる"],
  [false,1786,"flatter","お世辞を言う"],
  [false,1787,"prose","散文"],
  [false,1788,"textile","織物"],
  [false,1789,"timber","材木"],
  [false,1790,"masterpiece","傑作"],
  [false,1791,"riot","暴動"],
  [true,1792,"carriage","車両"],
  [false,1793,"apparatus","装置"],
  [false,1794,"fuss","大騒ぎ"],
  [false,1795,"deficiency","欠乏"],
  [false,1796,"heir","相続人"],
  [false,1797,"equator","赤道"],
  [false,1798,"petroleum","石油"],
  [false,1799,"witch","魔女"],
  [false,1800,"vapor","蒸気"],
  [false,1801,"probe","探査機"],
  [true,1802,"expertise","専門知識"],
  [false,1803,"scorn","軽蔑"],
  [false,1804,"prophet","預言者"],
  [false,1805,"breeze","そよ風"],
  [false,1806,"sin","罪"],
  [true,1807,"surge","急増"],
  [true,1808,"complement","補うもの"],
  [false,1809,"queue","列"],
  [false,1810,"stake","賭け金"],
  [false,1811,"ambassador","大使"],
  [false,1812,"jury","陪審員"],
  [true,1813,"cluster","集団"],
  [false,1814,"lump","こぶ"],
  [false,1815,"meadow","牧草地"],
  [false,1816,"feat","偉業"],
  [false,1817,"temperament","気質"],
  [false,1818,"chill","寒気"],
  [false,1819,"appliance","器具"],
  [false,1820,"predecessor","前任者"],
  [false,1821,"entity","存在"],
  [false,1822,"hospitality","もてなし"],
  [false,1823,"narrative","話"],
  [false,1824,"segment","部分、区分"],
  [false,1825,"catastrophe","大災害"],
  [false,1826,"monarch","君主、皇帝"],
  [true,1827,"constraint","制約"],
  [true,1828,"amendment","改正、修正"],
  [false,1829,"cosmos","宇宙"],
  [false,1830,"aisle","通路"],
  [false,1831,"hierarchy","階級制度"],
  [false,1832,"toll","通行料"],
  [false,1833,"transaction","取引"],
  [false,1834,"burglar","強盗"],
  [false,1835,"tyranny","圧政"],
  [false,1836,"parasite","寄生生物"],
  [false,1837,"intuition","直感"],
  [false,1838,"communist","共産主義の"],
  [false,1839,"legacy","遺産"],
  [false,1840,"vein","静脈"],
  [false,1841,"discourse","論説"],
  [true,1842,"dairy","乳製品、酪農"],
  [true,1843,"artifact","工芸品"],
  [false,1844,"outlet","はけ口"],
  [false,1845,"apprehension","不安"],
  [false,1846,"melancholy","憂うつ"],
  [false,1847,"novelty","目新しさ"],
  [false,1848,"specimen","標本"],
  [true,1849,"hygiene","衛生"],
  [false,1850,"tactics","戦術"],
  [false,1851,"monopoly","独占"],
  [false,1852,"token","印"],
  [false,1853,"aristocracy","貴族階級"],
  [false,1854,"revenge","復讐"],
  [true,1855,"activist","活動家"],
  [false,1856,"rhetoric","美辞麗句"],
  [true,1857,"entrepreneur","起業家"],
  [false,1858,"census","国勢調査"],
  [false,1859,"verge","瀬戸際"],
  [false,1860,"advent","出現、到来"],
  [false,1861,"analogy","類似点"],
  [false,1862,"irrigation","灌漑"],
  [false,1863,"coverage","報道"],
  [false,1864,"cuisine","料理"],
  [false,1865,"menace","脅威"],
  [false,1866,"peril","危険"],
  [false,1867,"limb","手足"],
  [false,1868,"assault","攻撃"],
  [false,1869,"hatred","憎しみ"],
  [false,1870,"autonomy","自主性"],
  [false,1871,"cram","塾"],
  [false,1872,"subsidy","補助金"],
  [true,1873,"empathy","共感"],
  [false,1874,"slang","俗語"],
  [false,1875,"posture","姿勢"],
  [false,1876,"ideology","イデオロギー"],
  [false,1877,"curse","災いのもと"],
  [false,1878,"tumor","腫瘍"],
  [false,1879,"intersection","交差点"],
  [true,1880,"duration","期間"],
  [false,1881,"deforestation","森林破壊"],
  [false,1882,"precaution","用心"],
  [true,1883,"bunch","ひとたばの"],
  [false,1884,"shortcoming","欠点"],
  [false,1885,"aspiration","熱望"],
  [false,1886,"psychiatrist","精神科医"],
  [false,1887,"shipping","発送"],
  [false,1888,"senator","上院議員"],
  [false,1889,"statesman","政治家"],
  [false,1890,"subordinate","部下"],
  [false,1891,"vacuum","空白"],
  [false,1892,"quest","探究"],
  [false,1893,"meditation","瞑想"],
  [false,1894,"subscriber","加入者"],
  [false,1895,"riddle","謎"],
  [false,1896,"rag","ぼろ"],
  [false,1897,"rust","さび"],
  [false,1898,"sanitation","衛生"],
  [false,1899,"midst","まっただ中"],
  [false,1900,"mischief","いたずら"],
  [true,1901,"proficiency","検定"],
  [false,1902,"recollection","記憶"],
  [false,1903,"latitude","緯"],
  [false,1904,"friction","摩擦"],
  [false,1905,"botanist","植物学者"],
  [false,1906,"heredity","遺伝"],
  [false,1907,"contempt","軽蔑"],
  [true,1908,"anatomy","構造"],
  [false,1909,"integrity","誠実"],
  [true,1910,"cargo","貨物"],
  [true,1911,"bribe","わいろ"],
  [false,1912,"eruption","噴火"],
  [false,1913,"funeral","葬式"],
  [false,1914,"deficit","赤字"],
  [false,1915,"bulk","大部分"],
  [false,1916,"millionaire","百万長者"],
  [false,1917,"ash","灰"],
  [false,1918,"realm","領域"],
  [false,1919,"plantation","農園"],
  [false,1920,"plow","すき"],
  [false,1921,"vending","販売"],
  [false,1922,"orphan","孤児"],
  [false,1923,"neuron","神経細胞"],
  [false,1924,"vegetation","植生"],
  [false,1925,"warrior","戦士"],
  [false,1926,"mutation","突然変異"],
  [false,1927,"sewage","下水"],
  [false,1928,"paradigm","理論的枠組"],
  [false,1929,"protocol","議定書"],
  [false,1930,"skyscraper","高層ビル"],
  [false,1931,"accord","一致"],
  [false,1932,"bureaucrat","官僚"],
  [true,1933,"array","多彩"],
  [true,1934,"clash","衝突"],
  [false,1935,"torture","拷問"],
  [false,1936,"reign","統治"],
  [true,1937,"thesis","論文"],
  [true,1938,"digit","桁"],
  [true,1939,"agenda","課題"],
  [true,1940,"onset","発症"],
  [false,1941,"peasant","小作農"],
  [false,1942,"ultraviolet","紫外"],
  [false,1943,"renowned","有名な"],
  [false,1944,"transparent","透き通った"],
  [false,1945,"dim","薄暗い"],
  [false,1946,"legitimate","正当な"],
  [true,1947,"adverse","悪"],
  [false,1948,"swift","すばやい"],
  [false,1949,"naive","世間知らずの"],
  [false,1950,"dumb","ばか"],
  [false,1951,"gloomy","暗い"],
  [false,1952,"furious","激怒した"],
  [false,1953,"earnest","まじめな"],
  [false,1954,"terrific","すばらしい"],
  [false,1955,"vertical","垂直な"],
  [false,1956,"wicked","邪悪な"],
  [false,1957,"subjective","主観的な"],
  [false,1958,"enlightened","進んだ考えの"],
  [true,1959,"authentic","本物の"],
  [false,1960,"brutal","残忍な"],
  [false,1961,"dizzy","めまい"],
  [false,1962,"sheer","まったくの"],
  [false,1963,"naughty","いたずらな"],
  [false,1964,"damp","湿った"],
  [false,1965,"static","静的な"],
  [false,1966,"doomed","運命にある"],
  [true,1967,"respiratory","呼吸器に関する、呼吸の"],
  [false,1968,"innumerable","無数の"],
  [false,1969,"clumsy","不器用な"],
  [false,1970,"aesthetic","美的"],
  [false,1971,"obsessed","とりつかれている"],
  [false,1972,"detached","切り離された"],
  [false,1973,"wrecked","難破した"],
  [false,1974,"reckless","無謀な"],
  [false,1975,"arrogant","傲慢な"],
  [false,1976,"preoccupied","頭がいっぱいだ"],
  [false,1977,"gigantic","巨大な"],
  [false,1978,"conspicuous","顕著な"],
  [false,1979,"slender","すらりとした"],
  [false,1980,"manifest","明らかな"],
  [false,1981,"tidy","きちんと"],
  [false,1982,"skeptical","懐疑的な"],
  [false,1983,"notorious","悪名高い"],
  [false,1984,"anonymous","匿名の"],
  [false,1985,"monotonous","単調な"],
  [false,1986,"ample","豊富に"],
  [false,1987,"trim","こぎれいな"],
  [false,1988,"savage","野蛮な"],
  [true,1989,"coherent","一貫した"],
  [false,1990,"eloquent","雄弁な"],
  [false,1991,"foul","不快な"],
  [false,1992,"juvenile","青少年の"],
  [false,1993,"compulsory","義務的な"],
  [false,1994,"prone","やすい"],
  [false,1995,"arbitrary","勝手な"],
  [false,1996,"ingenious","独創的な"],
  [false,1997,"divine","神聖なる"],
  [false,1998,"tender","やさしい"],
  [false,1999,"outraged","憤慨している"],
  [true,2000,"intrinsic","本来の"],
  [false,2001,"paralyzed","麻痺している"],
  [false,2002,"compatible","適合する"],
  [false,2003,"patriotic","愛国的な"],
  [false,2004,"eminent","名高い"],
  [true,2005,"potent","強力な"],
  [false,2006,"insane","正気を失っている"],
  [true,2007,"staple","主要な"],
  [false,2008,"secondhand","間接"],
  [false,2009,"indigenous","先住"],
  [false,2010,"utmost","最も"],
  [false,2011,"integral","不可欠な"],
  [false,2012,"intricate","複雑な"],
  [true,2013,"demographic","人口統計の"],
  [false,2014,"mighty","強力な"],
  [true,2015,"intact","無傷の"],
  [false,2016,"intent","決意をしている"],
  [false,2017,"intriguing","興味深い"],
  [false,2018,"merry","陽気な"],
  [false,2019,"perpetual","永続する"],
  [false,2020,"spinal","脊椎の"],
  [true,2021,"susceptible","かかりやすい"],
  [true,2022,"mandatory","義務的な"],
  [false,2023,"upright","まっすぐに"],
  [false,2024,"abruptly","不意に"],
  [false,2025,"conversely","逆に"],
  [false,2026,"predominantly","主に"],
  [true,2027,"lest","～しないように"]
];


// 発音記号（CMU辞書ベースの簡易IPA。未登録語は非表示）
const PHONETICS = {"abandon":"/ʌb ˈændʌn/","abolish":"/ʌb ˈɑlɪʃ/","abruptly":"/ʌbr ˈʌptli/","absolutely":"/ˌæbsʌl ˈutli/","absorb":"/ʌbz ˈɔrb/","abstract":"/æbstr ˈækt/","absurd":"/ʌbs ˈɝd/","abundant":"/ʌb ˈʌndʌnt/","abuse":"/ʌbj ˈus/","accelerate":"/æks ˈelɝ ˌeɪt/","accept":"/æks ˈept/","access":"/ˈæks ˌes/","accidentally":"/ˌæksʌd ˈentʌli/","accommodate":"/ʌk ˈɑmʌd ˌeɪt/","accompany":"/ʌk ˈʌmpʌni/","accomplish":"/ʌk ˈɑmplɪʃ/","accord":"/ʌk ˈɔrd/","accordingly":"/ʌk ˈɔrdɪŋli/","accumulate":"/ʌkj ˈumjʌl ˌeɪt/","accurate":"/ˈækjɝʌt/","accuse":"/ʌkj ˈuz/","accustomed":"/ʌk ˈʌstʌmd/","ache":"/ˈeɪk/","achieve":"/ʌtʃ ˈiv/","acid":"/ˈæsʌd/","acknowledge":"/ækn ˈɑlɪdʒ/","acquaintance":"/ʌkw ˈeɪntʌns/","acquire":"/ʌkw ˈaɪɝ/","activist":"/ˈæktʌvʌst/","acute":"/ʌkj ˈut/","adapt":"/ʌd ˈæpt/","add":"/ˈæd/","addicted":"/ʌd ˈɪktɪd/","adequate":"/ˈædʌkwʌt/","adhere":"/ʌdh ˈɪr/","adjust":"/ʌdʒ ˈʌst/","administration":"/ædm ˌɪnɪstr ˈeɪʃʌn/","admire":"/ædm ˈaɪr/","admit":"/ʌdm ˈɪt/","adolescent":"/ˌædʌl ˈesʌnt/","adopt":"/ʌd ˈɑpt/","adore":"/ʌd ˈɔr/","advance":"/ʌdv ˈæns/","advantage":"/ædv ˈæntɪdʒ/","advent":"/ˈædv ˌent/","adverse":"/ædv ˈɝs/","advertising":"/ˈædvɝt ˌaɪzɪŋ/","advise":"/ædv ˈaɪz/","advocate":"/ˈædvʌkʌt/","aesthetic":"/esθ ˈetɪk/","affair":"/ʌf ˈer/","affect":"/ʌf ˈekt/","affection":"/ʌf ˈekʃʌn/","affirm":"/ʌf ˈɝm/","affluent":"/ˈæfluʌnt/","afford":"/ʌf ˈɔrd/","afterward":"/ˈæftɝwɝd/","aged":"/ˈeɪdʒd/","agency":"/ˈeɪdʒʌnsi/","agenda":"/ʌdʒ ˈendʌ/","aggressive":"/ʌgr ˈesɪv/","agriculture":"/ˈægrɪk ˌʌltʃɝ/","aim":"/ˈeɪm/","aisle":"/ˈaɪl/","alarm":"/ʌl ˈɑrm/","alcoholic":"/ˌælkʌh ˈɑlɪk/","alert":"/ʌl ˈɝt/","alien":"/ˈeɪliʌn/","alike":"/ʌl ˈaɪk/","allocate":"/ˈælʌk ˌeɪt/","allow":"/ʌl ˈaʊ/","allowance":"/ʌl ˈaʊʌns/","ally":"/ˈælaɪ/","alter":"/ˈɔltɝ/","alternative":"/ɔlt ˈɝnʌtɪv/","altitude":"/ˈæltʌt ˌud/","altogether":"/ˌɔltʌg ˈeðɝ/","amaze":"/ʌm ˈeɪz/","ambassador":"/æmb ˈæsʌdɝ/","ambiguous":"/æmb ˈɪgjuʌs/","ambition":"/æmb ˈɪʃʌn/","ambulance":"/ˈæmbjʌlʌns/","amendment":"/ʌm ˈendmʌnt/","ample":"/ˈæmpʌl/","amuse":"/ʌmj ˈuz/","analogy":"/ʌn ˈælʌdʒi/","analysis":"/ʌn ˈælʌsʌs/","anatomy":"/ʌn ˈætʌmi/","ancestor":"/ˈæns ˌestɝ/","ancient":"/ˈeɪntʃʌnt/","anniversary":"/ˌænʌv ˈɝsɝi/","announce":"/ʌn ˈaʊns/","annoy":"/ʌn ˈɔɪ/","annual":"/ˈænjuʌl/","anonymous":"/ʌn ˈɑnʌmʌs/","anthropologist":"/ˌænθrʌp ˈɑlʌdʒʌst/","antibiotic":"/ˌæntibaɪ ˈɑtɪk/","anticipate":"/ænt ˈɪsʌp ˌeɪt/","antiquity":"/ænt ˈɪkwʌti/","anxious":"/ˈæŋkʃʌs/","ape":"/ˈeɪp/","apologize":"/ʌp ˈɑlʌdʒ ˌaɪz/","apparatus":"/ˌæpɝ ˈætʌs/","apparently":"/ʌp ˈerʌntli/","appeal":"/ʌp ˈil/","appearance":"/ʌp ˈɪrʌns/","appetite":"/ˈæpʌt ˌaɪt/","applaud":"/ʌpl ˈɔd/","appliance":"/ʌpl ˈaɪʌns/","apply":"/ʌpl ˈaɪ/","appoint":"/ʌp ˈɔɪnt/","appointment":"/ʌp ˈɔɪntmʌnt/","apprehension":"/ˌæprɪh ˈenʃʌn/","approach":"/ʌpr ˈoʊtʃ/","appropriate":"/ʌpr ˈoʊpriʌt/","approve":"/ʌpr ˈuv/","approximately":"/ʌpr ˈɑksʌmʌtli/","apt":"/ˈæpt/","arbitrary":"/ˈɑrbʌtr ˌeri/","archaeologist":"/ˌɑrki ˈɑlʌdʒɪst/","architecture":"/ˈɑrkʌt ˌektʃɝ/","argue":"/ˈɑrgju/","arise":"/ɝ ˈaɪz/","aristocracy":"/ˌerʌst ˈɑkrʌsi/","arithmetic":"/ˌerɪθm ˈetɪk/","arouse":"/ɝ ˈaʊz/","arrange":"/ɝ ˈeɪndʒ/","array":"/ɝ ˈeɪ/","arrest":"/ɝ ˈest/","arrogant":"/ˈerʌgʌnt/","artifact":"/ˈɑrtʌf ˌækt/","artificial":"/ˌɑrtʌf ˈɪʃʌl/","ash":"/ˈæʃ/","ashamed":"/ʌʃ ˈeɪmd/","aspect":"/ˈæsp ˌekt/","aspiration":"/ˌæspɝ ˈeɪʃʌn/","assault":"/ʌs ˈɔlt/","assemble":"/ʌs ˈembʌl/","assert":"/ʌs ˈɝt/","assess":"/ʌs ˈes/","asset":"/ˈæs ˌet/","assign":"/ʌs ˈaɪn/","assist":"/ʌs ˈɪst/","associate":"/ʌs ˈoʊsiʌt/","assure":"/ʌʃ ˈʊr/","astonish":"/ʌst ˈɑnɪʃ/","astronomy":"/ʌstr ˈɑnʌmi/","athlete":"/ˈæθl ˌit/","atmosphere":"/ˈætmʌsf ˌɪr/","attach":"/ʌt ˈætʃ/","attain":"/ʌt ˈeɪn/","attempt":"/ʌt ˈempt/","attitude":"/ˈætʌt ˌud/","attract":"/ʌtr ˈækt/","attribute":"/ˈætrʌbj ˌut/","audience":"/ˈɑdiʌns/","authentic":"/ʌθ ˈentɪk/","author":"/ˈɔθɝ/","autonomous":"/ɔt ˈɑnʌmʌs/","autonomy":"/ɔt ˈɑnʌmi/","available":"/ʌv ˈeɪlʌbʌl/","avoid":"/ʌv ˈɔɪd/","awaiting":"/ʌw ˈeɪtɪŋ/","awake":"/ʌw ˈeɪk/","award":"/ʌw ˈɔrd/","aware":"/ʌw ˈer/","awful":"/ˈɑfʌl/","awkward":"/ˈɑkwɝd/","background":"/b ˈækgr ˌaʊnd/","ban":"/b ˈæn/","bankrupt":"/b ˈæŋkrʌpt/","barely":"/b ˈerli/","bargain":"/b ˈɑrgʌn/","barrier":"/b ˈæriɝ/","base":"/b ˈeɪs/","basis":"/b ˈeɪsʌs/","bay":"/b ˈeɪ/","beast":"/b ˈist/","beg":"/b ˈeg/","behalf":"/bɪh ˈæf/","behavior":"/bɪh ˈeɪvjɝ/","belong":"/bɪl ˈɔŋ/","bend":"/b ˈend/","beneath":"/bɪn ˈiθ/","benefit":"/b ˈenʌfɪt/","besides":"/bɪs ˈaɪdz/","bet":"/b ˈet/","betray":"/bɪtr ˈeɪ/","beverage":"/b ˈevɝɪdʒ/","beyond":"/bɪ ˈɑnd/","bias":"/b ˈaɪʌs/","bilingual":"/baɪl ˈɪŋgwʌl/","billion":"/b ˈɪljʌn/","bind":"/b ˈaɪnd/","biography":"/baɪ ˈɑgrʌfi/","biological":"/b ˌaɪʌl ˈɑdʒɪkʌl/","bitter":"/b ˈɪtɝ/","blame":"/bl ˈeɪm/","blessing":"/bl ˈesɪŋ/","bloom":"/bl ˈum/","blossom":"/bl ˈɑsʌm/","blur":"/bl ˈɝ/","boast":"/b ˈoʊst/","bold":"/b ˈoʊld/","bomb":"/b ˈɑm/","bond":"/b ˈɑnd/","boost":"/b ˈust/","border":"/b ˈɔrdɝ/","bore":"/b ˈɔr/","borrow":"/b ˈɑr ˌoʊ/","botanist":"/b ˈɑtʌnɪst/","bother":"/b ˈɑðɝ/","bounce":"/b ˈaʊns/","boundary":"/b ˈaʊndɝi/","bow":"/b ˈaʊ/","brain":"/br ˈeɪn/","branch":"/br ˈæntʃ/","brave":"/br ˈeɪv/","breakdown":"/br ˈeɪkd ˌaʊn/","breakthrough":"/br ˈeɪkθr ˌu/","breathe":"/br ˈið/","breed":"/br ˈid/","breeze":"/br ˈiz/","bribe":"/br ˈaɪb/","bride":"/br ˈaɪd/","brief":"/br ˈif/","brilliant":"/br ˈɪljʌnt/","broadcast":"/br ˈɔdk ˌæst/","brutal":"/br ˈutʌl/","budget":"/b ˈʌdʒɪt/","bulk":"/b ˈʌlk/","bullet":"/b ˈʊlʌt/","bullying":"/b ˈʊliɪŋ/","bump":"/b ˈʌmp/","bunch":"/b ˈʌntʃ/","burden":"/b ˈɝdʌn/","bureaucrat":"/bj ˈʊrʌkr ˌæt/","burglar":"/b ˈɝglɝ/","burst":"/b ˈɝst/","bury":"/b ˈeri/","calculate":"/k ˈælkjʌl ˌeɪt/","calm":"/k ˈɑm/","campaign":"/kæmp ˈeɪn/","canal":"/kʌn ˈæl/","cancer":"/k ˈænsɝ/","candidate":"/k ˈændʌdeɪt/","capable":"/k ˈeɪpʌbʌl/","capacity":"/kʌp ˈæsʌti/","capture":"/k ˈæptʃɝ/","carbon":"/k ˈɑrbʌn/","career":"/kɝ ˈɪr/","cargo":"/k ˈɑrg ˌoʊ/","carriage":"/k ˈærɪdʒ/","cartoon":"/kɑrt ˈun/","carve":"/k ˈɑrv/","cast":"/k ˈæst/","castle":"/k ˈæsʌl/","casual":"/k ˈæʒʌwʌl/","catastrophe":"/kʌt ˈæstrʌfi/","category":"/k ˈætʌg ˌɔri/","cattle":"/k ˈætʌl/","caution":"/k ˈɑʃʌn/","cease":"/s ˈis/","celebrate":"/s ˈelʌbr ˌeɪt/","cell":"/s ˈel/","census":"/s ˈensʌs/","certificate":"/sɝt ˈɪfɪkʌt/","chaos":"/k ˈeɪɑs/","chapter":"/tʃ ˈæptɝ/","characteristic":"/k ˌerʌktɝ ˈɪstɪk/","charity":"/tʃ ˈerɪti/","charm":"/tʃ ˈɑrm/","chase":"/tʃ ˈeɪs/","chat":"/tʃ ˈæt/","cheat":"/tʃ ˈit/","cheer":"/tʃ ˈɪr/","chemical":"/k ˈemʌkʌl/","cherish":"/tʃ ˈerɪʃ/","chest":"/tʃ ˈest/","chew":"/tʃ ˈu/","chill":"/tʃ ˈɪl/","choke":"/tʃ ˈoʊk/","chore":"/tʃ ˈɔr/","chronic":"/kr ˈɑnɪk/","circulation":"/s ˈɝkjʌl ˌeɪʃʌn/","circumstances":"/s ˈɝkʌmst ˌænsʌz/","cite":"/s ˈaɪt/","citizen":"/s ˈɪtʌzʌn/","civil":"/s ˈɪvʌl/","civilization":"/s ˌɪvʌlɪz ˈeɪʃʌn/","claim":"/kl ˈeɪm/","clap":"/kl ˈæp/","clarify":"/kl ˈerʌf ˌaɪ/","clash":"/kl ˈæʃ/","classical":"/kl ˈæsɪkʌl/","classify":"/kl ˈæsʌf ˌaɪ/","client":"/kl ˈaɪʌnt/","climate":"/kl ˈaɪmʌt/","cling":"/kl ˈɪŋ/","clinical":"/kl ˈɪnʌkʌl/","clue":"/kl ˈu/","clumsy":"/kl ˈʌmzi/","cluster":"/kl ˈʌstɝ/","code":"/k ˈoʊd/","cognitive":"/k ˈɑgnɪtɪv/","coherent":"/koʊh ˈɪrʌnt/","coincide":"/k ˌoʊɪns ˈaɪd/","collapse":"/kʌl ˈæps/","colleague":"/k ˈɑlig/","collective":"/kʌl ˈektɪv/","collision":"/kʌl ˈɪʒʌn/","colony":"/k ˈɑlʌni/","column":"/k ˈɑlʌm/","combat":"/k ˈɑmbæt/","combine":"/k ˈɑmbaɪn/","comfortable":"/k ˈʌmfɝtʌbʌl/","commerce":"/k ˈɑmɝs/","commit":"/kʌm ˈɪt/","committee":"/kʌm ˈɪti/","commodity":"/kʌm ˈɑdʌti/","common":"/k ˈɑmʌn/","communist":"/k ˈɑmjʌnʌst/","commute":"/kʌmj ˈut/","companion":"/kʌmp ˈænjʌn/","compare":"/kʌmp ˈer/","compatible":"/kʌmp ˈætʌbʌl/","compel":"/kʌmp ˈel/","compensate":"/k ˈɑmpʌns ˌeɪt/","compete":"/kʌmp ˈit/","competent":"/k ˈɑmpʌtɪnt/","compile":"/kʌmp ˈaɪl/","complain":"/kʌmpl ˈeɪn/","complement":"/k ˈɑmplʌmʌnt/","complete":"/kʌmpl ˈit/","complex":"/k ˈɑmpleks/","complicated":"/k ˈɑmplʌk ˌeɪtʌd/","compliment":"/k ˈɑmplʌment/","comply":"/kʌmpl ˈaɪ/","component":"/kʌmp ˈoʊnʌnt/","compose":"/kʌmp ˈoʊz/","compound":"/k ˈɑmpaʊnd/","comprehend":"/k ˌɑmprih ˈend/","comprehensive":"/k ˌɑmprih ˈensɪv/","comprise":"/kʌmpr ˈaɪz/","compromise":"/k ˈɑmprʌm ˌaɪz/","compulsory":"/kʌmp ˈʌlsɝi/","conceal":"/kʌns ˈil/","conceive":"/kʌns ˈiv/","concentrate":"/k ˈɑnsʌntr ˌeɪt/","concept":"/k ˈɑnsept/","conclude":"/kʌnkl ˈud/","concrete":"/kʌnkr ˈit/","condemn":"/kʌnd ˈem/","conference":"/k ˈɑnfɝʌns/","confess":"/kʌnf ˈes/","confidence":"/k ˈɑnfʌdʌns/","confine":"/kʌnf ˈaɪn/","confirm":"/kʌnf ˈɝm/","conflict":"/k ˈɑnflɪkt/","conform":"/kʌnf ˈɔrm/","confront":"/kʌnfr ˈʌnt/","confuse":"/kʌnfj ˈuz/","congratulate":"/kʌngr ˈætʃʌl ˌeɪt/","congress":"/k ˈɑŋgrʌs/","connect":"/kʌn ˈekt/","conquer":"/k ˈɑŋkɝ/","conscience":"/k ˈɑnʃʌns/","conscious":"/k ˈɑnʃʌs/","consensus":"/kʌns ˈensʌs/","consent":"/kʌns ˈent/","consequence":"/k ˈɑnsʌkwʌns/","conservation":"/k ˌɑnsɝv ˈeɪʃʌn/","conservative":"/kʌns ˈɝvʌtɪv/","consider":"/kʌns ˈɪdɝ/","considerable":"/kʌns ˈɪdɝʌbʌl/","consist":"/kʌns ˈɪst/","consistent":"/kʌns ˈɪstʌnt/","conspicuous":"/kʌnsp ˈɪkjuʌs/","constitute":"/k ˈɑnstʌt ˌut/","constitution":"/k ˌɑnstʌt ˈuʃʌn/","constraint":"/kʌnstr ˈeɪnt/","construction":"/kʌnstr ˈʌkʃʌn/","consult":"/kʌns ˈʌlt/","consume":"/kʌns ˈum/","contain":"/kʌnt ˈeɪn/","contaminated":"/kʌnt ˈæmʌn ˌeɪtɪd/","contemplate":"/k ˈɑntʌmpl ˌeɪt/","contemporary":"/kʌnt ˈempɝ ˌeri/","contempt":"/kʌnt ˈempt/","contend":"/kʌnt ˈend/","context":"/k ˈɑntekst/","continent":"/k ˈɑntʌnʌnt/","continue":"/kʌnt ˈɪnju/","contract":"/k ˈɑntr ˌækt/","contradict":"/k ˌɑntrʌd ˈɪkt/","contrary":"/k ˈɑntreri/","contrast":"/k ˈɑntræst/","contribute":"/kʌntr ˈɪbjut/","controversial":"/k ˌɑntrʌv ˈɝʃʌl/","convenient":"/kʌnv ˈinjʌnt/","convention":"/kʌnv ˈenʃʌn/","conversely":"/k ˈɑnvɝsli/","convert":"/k ˈɑnvɝt/","convey":"/kʌnv ˈeɪ/","convince":"/kʌnv ˈɪns/","cooperate":"/koʊ ˈɑpɝ ˌeɪt/","coordinate":"/koʊ ˈɔrdʌnʌt/","cope":"/k ˈoʊp/","core":"/k ˈɔr/","corporation":"/k ˌɔrpɝ ˈeɪʃʌn/","correct":"/kɝ ˈekt/","correspond":"/k ˌɔrʌsp ˈɑnd/","corruption":"/kɝ ˈʌpʃʌn/","cosmos":"/k ˈɑzmoʊs/","cost":"/k ˈɑst/","cough":"/k ˈɑf/","council":"/k ˈaʊnsʌl/","counterpart":"/k ˈaʊntɝp ˌɑrt/","countless":"/k ˈaʊntlʌs/","courage":"/k ˈɝʌdʒ/","courtesy":"/k ˈɝtʌsi/","coverage":"/k ˈʌvɝʌdʒ/","craft":"/kr ˈæft/","cram":"/kr ˈæm/","crash":"/kr ˈæʃ/","crawl":"/kr ˈɔl/","creature":"/kr ˈitʃɝ/","crew":"/kr ˈu/","crime":"/kr ˈaɪm/","crisis":"/kr ˈaɪsʌs/","criteria":"/kraɪt ˈɪriʌ/","criticize":"/kr ˈɪtɪs ˌaɪz/","crop":"/kr ˈɑp/","crowd":"/kr ˈaʊd/","crucial":"/kr ˈuʃʌl/","crude":"/kr ˈud/","cruel":"/kr ˈuʌl/","crush":"/kr ˈʌʃ/","cue":"/kj ˈu/","cuisine":"/kwɪz ˈin/","cultivate":"/k ˈʌltʌv ˌeɪt/","curb":"/k ˈɝb/","cure":"/kj ˈʊr/","curious":"/kj ˈʊriʌs/","current":"/k ˈɝʌnt/","curriculum":"/kɝ ˈɪkjʌlʌm/","curse":"/k ˈɝs/","custom":"/k ˈʌstʌm/","dairy":"/d ˈeri/","damp":"/d ˈæmp/","dare":"/d ˈer/","dawn":"/d ˈɔn/","deadline":"/d ˈedl ˌaɪn/","deaf":"/d ˈef/","debate":"/dʌb ˈeɪt/","debris":"/dʌbr ˈi/","debt":"/d ˈet/","decade":"/dek ˈeɪd/","decay":"/dɪk ˈeɪ/","deceive":"/dɪs ˈiv/","decent":"/d ˈisʌnt/","decide":"/d ˌɪs ˈaɪd/","declare":"/dɪkl ˈer/","decline":"/dɪkl ˈaɪn/","decorate":"/d ˈekɝ ˌeɪt/","dedicate":"/d ˈedʌk ˌeɪt/","deed":"/d ˈid/","defeat":"/dɪf ˈit/","defect":"/d ˈifekt/","defend":"/dɪf ˈend/","deficiency":"/dɪf ˈɪʃʌnsi/","deficit":"/d ˈefʌsʌt/","define":"/dɪf ˈaɪn/","definitely":"/d ˈefʌnʌtli/","deforestation":"/dɪf ˌɔrɪst ˈeɪʃʌn/","defy":"/dɪf ˈaɪ/","degrade":"/dɪgr ˈeɪd/","delay":"/dɪl ˈeɪ/","delete":"/dɪl ˈit/","deliberately":"/dɪl ˈɪbɝʌtli/","delicate":"/d ˈelʌkʌt/","delight":"/dɪl ˈaɪt/","deliver":"/dɪl ˈɪvɝ/","demand":"/dɪm ˈænd/","dementia":"/dɪm ˈenʃiʌ/","democracy":"/dɪm ˈɑkrʌsi/","demographic":"/d ˌemʌgr ˈæfɪk/","demonstrate":"/d ˈemʌnstr ˌeɪt/","density":"/d ˈensʌti/","department":"/dɪp ˈɑrtmʌnt/","departure":"/dɪp ˈɑrtʃɝ/","depend":"/dɪp ˈend/","depict":"/dɪp ˈɪkt/","deposit":"/dʌp ˈɑzɪt/","depress":"/dɪpr ˈes/","deprive":"/dɪpr ˈaɪv/","derive":"/dɝ ˈaɪv/","descend":"/dɪs ˈend/","describe":"/dɪskr ˈaɪb/","desert":"/d ˈezɝt/","deserve":"/dɪz ˈɝv/","designate":"/d ˈezʌgn ˌeɪt/","desire":"/dɪz ˈaɪɝ/","despair":"/dɪsp ˈer/","desperate":"/d ˈesprɪt/","despise":"/dɪsp ˈaɪz/","despite":"/dɪsp ˈaɪt/","destination":"/d ˌestʌn ˈeɪʃʌn/","destiny":"/d ˈestʌni/","destroy":"/dɪstr ˈɔɪ/","detached":"/dɪt ˈætʃt/","detail":"/dɪt ˈeɪl/","detect":"/dɪt ˈekt/","deteriorate":"/dɪt ˈɪriɝ ˌeɪt/","determine":"/dʌt ˈɝmʌn/","devastate":"/d ˈevʌst ˌeɪt/","develop":"/dɪv ˈelʌp/","device":"/dɪv ˈaɪs/","devote":"/dɪv ˈoʊt/","diabetes":"/d ˌaɪʌb ˈitiz/","diagnosis":"/d ˌaɪʌgn ˈoʊsʌs/","dialect":"/d ˈaɪʌl ˌekt/","dialogue":"/d ˈaɪʌl ˌɔg/","diameter":"/daɪ ˈæmʌtɝ/","dictate":"/dɪkt ˈeɪt/","differ":"/d ˈɪfɝ/","digest":"/daɪdʒ ˈest/","digit":"/d ˈɪdʒʌt/","dignity":"/d ˈɪgnʌti/","diligent":"/d ˈɪlɪdʒʌnt/","dim":"/d ˈɪm/","dimension":"/dɪm ˈenʃʌn/","diminish":"/dɪm ˈɪnɪʃ/","dinosaur":"/d ˈaɪnʌs ˌɔr/","dip":"/d ˈɪp/","diplomatic":"/d ˌɪplʌm ˈætɪk/","disability":"/d ˌɪsʌb ˈɪlɪti/","disappoint":"/d ˌɪsʌp ˈɔɪnt/","disaster":"/dɪz ˈæstɝ/","discard":"/dɪsk ˈɑrd/","discern":"/dɪs ˈɝn/","discharge":"/dɪstʃ ˈɑrdʒ/","disclose":"/dɪskl ˈoʊz/","discourse":"/d ˈɪskɔrs/","discrimination":"/dɪskr ˌɪmʌn ˈeɪʃʌn/","discuss":"/dɪsk ˈʌs/","disguise":"/dɪsg ˈaɪz/","disgust":"/dɪsg ˈʌst/","dismiss":"/dɪsm ˈɪs/","displace":"/dɪspl ˈeɪs/","display":"/dɪspl ˈeɪ/","dispose":"/dɪsp ˈoʊz/","dispute":"/dɪspj ˈut/","disregard":"/d ˌɪsrɪg ˈɑrd/","disrupt":"/dɪsr ˈʌpt/","dissolve":"/dɪz ˈɑlv/","distance":"/d ˈɪstʌns/","distinguish":"/dɪst ˈɪŋgwɪʃ/","distort":"/dɪst ˈɔrt/","distract":"/dɪstr ˈækt/","distress":"/dɪstr ˈes/","distribute":"/dɪstr ˈɪbjut/","district":"/d ˈɪstrɪkt/","disturb":"/dɪst ˈɝb/","diversity":"/dɪv ˈɝsɪti/","divert":"/daɪv ˈɝt/","divide":"/dɪv ˈaɪd/","divine":"/dɪv ˈaɪn/","divorce":"/dɪv ˈɔrs/","dizzy":"/d ˈɪzi/","document":"/d ˈɑkjʌment/","domain":"/doʊm ˈeɪn/","domestic":"/dʌm ˈestɪk/","dominate":"/d ˈɑmʌn ˌeɪt/","donate":"/d ˈoʊn ˌeɪt/","doomed":"/d ˈumd/","dose":"/d ˈoʊs/","dozen":"/d ˈʌzʌn/","draft":"/dr ˈæft/","drag":"/dr ˈæg/","drain":"/dr ˈeɪn/","drastically":"/dr ˈæstɪkli/","draw":"/dr ˈɔ/","dread":"/dr ˈed/","drift":"/dr ˈɪft/","drought":"/dr ˈaʊt/","drown":"/dr ˈaʊn/","dull":"/d ˈʌl/","dumb":"/d ˈʌm/","dump":"/d ˈʌmp/","duration":"/d ˈʊr ˈeɪʃʌn/","dust":"/d ˈʌst/","duty":"/d ˈuti/","dwell":"/dw ˈel/","eager":"/ˈigɝ/","earn":"/ˈɝn/","earnest":"/ˈɝnɪst/","earthquake":"/ˈɝθkw ˌeɪk/","ecological":"/ikʌl ˈɑdʒɪkʌl/","economy":"/ɪk ˈɑnʌmi/","edge":"/ˈedʒ/","editor":"/ˈedʌtɝ/","educate":"/ˈedʒʌk ˌeɪt/","effect":"/ɪf ˈekt/","efficient":"/ɪf ˈɪʃʌnt/","effort":"/ˈefɝt/","elaborate":"/ɪl ˈæbrʌt/","elderly":"/ˈeldɝli/","elect":"/ɪl ˈekt/","electricity":"/ɪl ˌektr ˈɪsʌti/","element":"/ˈelʌmʌnt/","eliminate":"/ɪl ˈɪmʌn ˌeɪt/","eloquent":"/ˈelʌkwʌnt/","embark":"/emb ˈɑrk/","embarrass":"/ɪmb ˈerʌs/","embody":"/ɪmb ˈɑdi/","embrace":"/embr ˈeɪs/","emerge":"/ɪm ˈɝdʒ/","emergency":"/ɪm ˈɝdʒʌnsi/","eminent":"/ˈemʌnʌnt/","emission":"/ɪm ˈɪʃʌn/","emotion":"/ɪm ˈoʊʃʌn/","empathy":"/ˈempʌθi/","emphasize":"/ˈemfʌs ˌaɪz/","empire":"/ˈempaɪɝ/","employ":"/empl ˈɔɪ/","empty":"/ˈempti/","enable":"/en ˈeɪbʌl/","enclose":"/ɪnkl ˈoʊz/","encounter":"/ɪnk ˈaʊntɝ/","encourage":"/enk ˈɝɪdʒ/","encyclopedia":"/ɪns ˌaɪklʌp ˈidiʌ/","endanger":"/end ˈeɪndʒɝ/","endeavor":"/ɪnd ˈevɝ/","endowed":"/end ˈaʊd/","endure":"/endj ˈʊr/","enemy":"/ˈenʌmi/","enforce":"/enf ˈɔrs/","engage":"/eng ˈeɪdʒ/","enhance":"/enh ˈæns/","enlightened":"/ˌenl ˈaɪtʌnd/","enormous":"/ɪn ˈɔrmʌs/","enrich":"/enr ˈɪtʃ/","enroll":"/enr ˈoʊl/","ensure":"/enʃ ˈʊr/","enterprise":"/ˈentɝpr ˌaɪz/","entertain":"/ˌentɝt ˈeɪn/","enthusiasm":"/ɪnθ ˈuzi ˌæzʌm/","entire":"/ɪnt ˈaɪɝ/","entitled":"/ent ˈaɪtʌld/","entity":"/ˈentʌti/","entrepreneur":"/ˌɑntrʌprʌn ˈɝ/","envelope":"/ˈenvʌl ˌoʊp/","environment":"/ɪnv ˈaɪrʌnmʌnt/","envy":"/ˈenvi/","epidemic":"/ˌepʌd ˈemɪk/","equation":"/ɪkw ˈeɪʒʌn/","equator":"/ɪkw ˈeɪtɝ/","equip":"/ɪkw ˈɪp/","equipment":"/ɪkw ˈɪpmʌnt/","equivalent":"/ɪkw ˈɪvʌlʌnt/","era":"/ˈerʌ/","erase":"/ɪr ˈeɪs/","erect":"/ɪr ˈekt/","erosion":"/ɪr ˈoʊʒʌn/","eruption":"/ˌir ˈʌpʃʌn/","escape":"/ɪsk ˈeɪp/","essential":"/es ˈenʃʌl/","establish":"/ɪst ˈæblɪʃ/","estate":"/ɪst ˈeɪt/","estimate":"/ˈestʌmʌt/","eternal":"/ɪt ˈɝnʌl/","ethic":"/ˈeθɪk/","ethnic":"/ˈeθnɪk/","evacuated":"/ɪv ˈækjʌw ˌeɪtɪd/","evaluate":"/ɪv ˈælju ˌeɪt/","eventually":"/ɪv ˈentʃʌwʌli/","evidence":"/ˈevʌdʌns/","evil":"/ˈivʌl/","evoke":"/ɪv ˈoʊk/","evolution":"/ˌevʌl ˈuʃʌn/","exactly":"/ɪgz ˈæktli/","exaggerate":"/ɪgz ˈædʒɝ ˌeɪt/","examine":"/ɪgz ˈæmɪn/","exceed":"/ɪks ˈid/","excellent":"/ˈeksʌlʌnt/","except":"/ɪks ˈept/","exception":"/ɪks ˈepʃʌn/","excessive":"/ɪks ˈesɪv/","exchange":"/ɪkstʃ ˈeɪndʒ/","exclaim":"/ɪkskl ˈeɪm/","excuse":"/ɪkskj ˈus/","execute":"/ˈeksʌkj ˌut/","executive":"/ɪgz ˈekjʌtɪv/","exert":"/ɪgz ˈɝt/","exhausted":"/ɪgz ˈɔstɪd/","exhibit":"/ɪgz ˈɪbɪt/","exist":"/ɪgz ˈɪst/","exotic":"/ɪgz ˈɑtɪk/","expand":"/ɪksp ˈænd/","expect":"/ɪksp ˈekt/","expedition":"/ˌekspʌd ˈɪʃʌn/","expensive":"/ɪksp ˈensɪv/","experiment":"/ɪksp ˈerʌmʌnt/","expertise":"/ˌekspɝt ˈiz/","expire":"/ɪksp ˈaɪr/","explain":"/ɪkspl ˈeɪn/","explicit":"/ɪkspl ˈɪsʌt/","exploit":"/ˈekspl ˌɔɪt/","explore":"/ɪkspl ˈɔr/","explosion":"/ɪkspl ˈoʊʒʌn/","expose":"/ɪksp ˈoʊz/","express":"/ɪkspr ˈes/","extend":"/ɪkst ˈend/","extent":"/ɪkst ˈent/","extinction":"/ɪkst ˈɪŋkʃʌn/","extinguish":"/ɪkst ˈɪŋgwɪʃ/","extract":"/ˈekstr ˌækt/","extraordinary":"/ˌekstrʌ ˈɔrdʌn ˌeri/","extremely":"/ekstr ˈimli/","fabric":"/f ˈæbrɪk/","facility":"/fʌs ˈɪlɪti/","factor":"/f ˈæktɝ/","faculty":"/f ˈækʌlti/","fade":"/f ˈeɪd/","faint":"/f ˈeɪnt/","faith":"/f ˈeɪθ/","fake":"/f ˈeɪk/","false":"/f ˈɔls/","fame":"/f ˈeɪm/","familiar":"/fʌm ˈɪljɝ/","famine":"/f ˈæmʌn/","fantastic":"/fænt ˈæstɪk/","fare":"/f ˈer/","fascinate":"/f ˈæsʌn ˌeɪt/","fate":"/f ˈeɪt/","fatigue":"/fʌt ˈig/","favor":"/f ˈeɪvɝ/","favorite":"/f ˈeɪvɝɪt/","feast":"/f ˈist/","feat":"/f ˈit/","feature":"/f ˈitʃɝ/","federal":"/f ˈedɝʌl/","fee":"/f ˈi/","feed":"/f ˈid/","fellow":"/f ˈeloʊ/","feminine":"/f ˈemʌnʌn/","fertile":"/f ˈɝtʌl/","fetch":"/f ˈetʃ/","fever":"/f ˈivɝ/","fiction":"/f ˈɪkʃʌn/","fierce":"/f ˈɪrs/","financial":"/fʌn ˈænʃʌl/","finding":"/f ˈaɪndɪŋ/","flame":"/fl ˈeɪm/","flatter":"/fl ˈætɝ/","flavor":"/fl ˈeɪvɝ/","flaw":"/fl ˈɔ/","flee":"/fl ˈi/","flesh":"/fl ˈeʃ/","flexible":"/fl ˈeksʌbʌl/","floating":"/fl ˈoʊtɪŋ/","flock":"/fl ˈɑk/","flood":"/fl ˈʌd/","flourishing":"/fl ˈɝɪʃɪŋ/","fluent":"/fl ˈuʌnt/","fluid":"/fl ˈuʌd/","focus":"/f ˈoʊkʌs/","fold":"/f ˈoʊld/","folk":"/f ˈoʊk/","follow":"/f ˈɑloʊ/","fond":"/f ˈɑnd/","forbid":"/fɝb ˈɪd/","force":"/f ˈɔrs/","forecast":"/f ˈɔrk ˌæst/","foresee":"/fɔrs ˈi/","forgive":"/fɝg ˈɪv/","former":"/f ˈɔrmɝ/","formula":"/f ˈɔrmjʌlʌ/","fossil":"/f ˈɑsʌl/","foster":"/f ˈɑstɝ/","foul":"/f ˈaʊl/","found":"/f ˈaʊnd/","fraction":"/fr ˈækʃʌn/","fragile":"/fr ˈædʒʌl/","fragment":"/fr ˈægmʌnt/","frame":"/fr ˈeɪm/","frankly":"/fr ˈæŋkli/","freeze":"/fr ˈiz/","frequently":"/fr ˈikwʌntli/","friction":"/fr ˈɪkʃʌn/","frighten":"/fr ˈaɪtʌn/","frontier":"/frʌnt ˈɪr/","frown":"/fr ˈaʊn/","frustrate":"/fr ˈʌstr ˌeɪt/","fuel":"/fj ˈuʌl/","fulfill":"/fʊlf ˈɪl/","function":"/f ˈʌŋkʃʌn/","fund":"/f ˈʌnd/","fundamental":"/f ˌʌndʌm ˈentʌl/","funeral":"/fj ˈunɝʌl/","furious":"/fj ˈʊriʌs/","furniture":"/f ˈɝnɪtʃɝ/","fuss":"/f ˈʌs/","gain":"/g ˈeɪn/","galaxy":"/g ˈælʌksi/","garbage":"/g ˈɑrbɪdʒ/","garment":"/g ˈɑrmʌnt/","gaze":"/g ˈeɪz/","gender":"/dʒ ˈendɝ/","gene":"/dʒ ˈin/","general":"/dʒ ˈenɝʌl/","generate":"/dʒ ˈenɝ ˌeɪt/","generation":"/dʒ ˌenɝ ˈeɪʃʌn/","generous":"/dʒ ˈenɝʌs/","genius":"/dʒ ˈinjʌs/","genuine":"/dʒ ˈenjʌwʌn/","geography":"/dʒi ˈɑgrʌfi/","geological":"/dʒ ˌiʌl ˈɑdʒɪkʌl/","germ":"/dʒ ˈɝm/","gigantic":"/dʒaɪg ˈæntɪk/","glance":"/gl ˈæns/","glimpse":"/gl ˈɪmps/","gloomy":"/gl ˈumi/","glory":"/gl ˈɔri/","glow":"/gl ˈoʊ/","goods":"/g ˈʊdz/","government":"/g ˈʌvɝmʌnt/","grab":"/gr ˈæb/","grace":"/gr ˈeɪs/","gradually":"/gr ˈædʒuʌli/","graduate":"/gr ˈædʒʌwʌt/","grain":"/gr ˈeɪn/","grant":"/gr ˈænt/","grasp":"/gr ˈæsp/","grateful":"/gr ˈeɪtfʌl/","grave":"/gr ˈeɪv/","gravity":"/gr ˈævʌti/","greedy":"/gr ˈidi/","greet":"/gr ˈit/","grief":"/gr ˈif/","grocery":"/gr ˈoʊsɝi/","gross":"/gr ˈoʊs/","guarantee":"/g ˌerʌnt ˈi/","guess":"/g ˈes/","guilty":"/g ˈɪlti/","habit":"/h ˈæbʌt/","habitat":"/h ˈæbʌt ˌæt/","halt":"/h ˈɔlt/","handle":"/h ˈændʌl/","hardly":"/h ˈɑrdli/","hardship":"/h ˈɑrdʃɪp/","harm":"/h ˈɑrm/","harsh":"/h ˈɑrʃ/","harvest":"/h ˈɑrvʌst/","haste":"/h ˈeɪst/","hatch":"/h ˈætʃ/","hatred":"/h ˈeɪtrʌd/","haunted":"/h ˈɔntɪd/","hazard":"/h ˈæzɝd/","headline":"/h ˈedl ˌaɪn/","headquarters":"/h ˈedkw ˌɔrtɝz/","heal":"/h ˈil/","heaven":"/h ˈevʌn/","height":"/h ˈaɪt/","heir":"/ˈer/","helpless":"/h ˈelplʌs/","hemisphere":"/h ˈemɪsf ˌɪr/","hence":"/h ˈens/","heredity":"/hɝ ˈedʌti/","heritage":"/h ˈerʌtʌdʒ/","hesitate":"/h ˈezʌt ˌeɪt/","hierarchy":"/h ˈaɪɝ ˌɑrki/","hinder":"/h ˈɪndɝ/","hire":"/h ˈaɪɝ/","honor":"/ˈɑnɝ/","horizon":"/hɝ ˈaɪzʌn/","horror":"/h ˈɔrɝ/","hospitality":"/h ˌɑspʌt ˈælʌti/","hostile":"/h ˈɑstʌl/","household":"/h ˈaʊsh ˌoʊld/","hug":"/h ˈʌg/","huge":"/hj ˈudʒ/","humble":"/h ˈʌmbʌl/","humid":"/hj ˈumʌd/","humiliate":"/hjum ˈɪli ˌeɪt/","hurt":"/h ˈɝt/","hybrid":"/h ˈaɪbrʌd/","hygiene":"/h ˈaɪdʒ ˌin/","hypothesis":"/haɪp ˈɑθʌsʌs/","ideal":"/aɪd ˈil/","identify":"/aɪd ˈentʌf ˌaɪ/","ideology":"/ˌaɪdi ˈɑlʌdʒi/","idle":"/ˈaɪdʌl/","ignorant":"/ˈɪgnɝʌnt/","ignore":"/ˌɪgn ˈɔr/","illuminate":"/ˌɪl ˈumɪnɪt/","illusion":"/ˌɪl ˈuʒʌn/","illustrate":"/ˈɪlʌstr ˌeɪt/","imaginary":"/ˌɪm ˈædʒʌn ˌeri/","imitate":"/ˈɪmʌt ˌeɪt/","immediately":"/ˌɪm ˈid ˌiʌtli/","immense":"/ˌɪm ˈens/","immersed":"/ˌɪm ˈɝst/","immigrant":"/ˈɪmʌgrʌnt/","immune":"/ˌɪmj ˈun/","impact":"/ˌɪmp ˈækt/","impair":"/ˌɪmp ˈer/","implement":"/ˈɪmplʌmʌnt/","imply":"/ˌɪmpl ˈaɪ/","import":"/ˌɪmp ˈɔrt/","impose":"/ˌɪmp ˈoʊz/","impression":"/ˌɪmpr ˈeʃʌn/","improve":"/ˌɪmpr ˈuv/","impulse":"/ˈɪmpʌls/","in spite of":"/ɪn sp ˈaɪt ˈʌv/","incentive":"/ˌɪns ˈentɪv/","incident":"/ˈɪnsʌdʌnt/","inclined":"/ˌɪnkl ˈaɪnd/","include":"/ˌɪnkl ˈud/","income":"/ˈɪnk ˌʌm/","incorporate":"/ˌɪnk ˈɔrpɝ ˌeɪt/","increase":"/ˌɪnkr ˈis/","incredible":"/ˌɪnkr ˈedʌbʌl/","independent":"/ˌɪndɪp ˈendʌnt/","indicate":"/ˈɪndʌk ˌeɪt/","indifferent":"/ˌɪnd ˈɪfrʌnt/","indigenous":"/ˌɪnd ˈɪdʒʌnʌs/","indispensable":"/ˌɪndɪsp ˈensʌbʌl/","individual":"/ˌɪndʌv ˈɪdʒʌwʌl/","induce":"/ˌɪnd ˈus/","indulge":"/ˌɪnd ˈʌldʒ/","industry":"/ˈɪndʌstri/","inevitable":"/ˌɪn ˈevʌtʌbʌl/","infant":"/ˈɪnfʌnt/","infect":"/ˌɪnf ˈekt/","inferred":"/ˌɪnf ˈɝd/","infinite":"/ˈɪnfʌnʌt/","inflammation":"/ˌɪnflʌm ˈeɪʃʌn/","inflict":"/ˌɪnfl ˈɪkt/","influence":"/ˈɪnfluʌns/","inform":"/ˌɪnf ˈɔrm/","ingenious":"/ˌɪndʒ ˈinjʌs/","ingredient":"/ˌɪngr ˈidiʌnt/","inhabitant":"/ɪnh ˈæbʌtʌnt/","inherent":"/ɪnh ˈɪrʌnt/","inherit":"/ˌɪnh ˈerʌt/","inhibit":"/ˌɪnh ˈɪbʌt/","initial":"/ˌɪn ˈɪʃʌl/","initiative":"/ˌɪn ˈɪʃʌtɪv/","injection":"/ˌɪndʒ ˈekʃʌn/","injure":"/ˈɪndʒɝ/","innate":"/ˌɪn ˈeɪt/","inner":"/ˈɪnɝ/","innocent":"/ˈɪnʌsʌnt/","innovation":"/ˌɪnʌv ˈeɪʃʌn/","innumerable":"/ˌɪn ˈumɝʌbʌl/","inquiry":"/ˌɪnkw ˈaɪr ˌi/","insane":"/ˌɪns ˈeɪn/","insect":"/ˈɪns ˌekt/","insert":"/ˌɪns ˈɝt/","insight":"/ˈɪns ˌaɪt/","insist":"/ˌɪns ˈɪst/","inspect":"/ˌɪnsp ˈekt/","inspire":"/ˌɪnsp ˈaɪr/","install":"/ˌɪnst ˈɔl/","instance":"/ˈɪnstʌns/","instantly":"/ˈɪnstʌntli/","instinct":"/ˈɪnstɪŋkt/","institution":"/ˌɪnstɪt ˈuʃʌn/","instruction":"/ˌɪnstr ˈʌkʃʌn/","instrument":"/ˈɪnstrʌmʌnt/","insult":"/ˌɪns ˈʌlt/","insurance":"/ˌɪnʃ ˈʊrʌns/","intact":"/ˌɪnt ˈækt/","intake":"/ˈɪnt ˌeɪk/","integral":"/ˈɪntʌgrʌl/","integrate":"/ˈɪntʌgr ˌeɪt/","integrity":"/ˌɪnt ˈegrʌti/","intellectual":"/ˌɪntʌl ˈektʃuʌl/","intend":"/ˌɪnt ˈend/","intense":"/ˌɪnt ˈens/","intent":"/ˌɪnt ˈent/","interaction":"/ˌɪntɝ ˈækʃʌn/","interfere":"/ˌɪntɝf ˈɪr/","internal":"/ˌɪnt ˈɝnʌl/","interpret":"/ˌɪnt ˈɝprʌt/","interrupt":"/ˌɪntɝ ˈʌpt/","intersection":"/ˌɪntɝs ˈekʃʌn/","interval":"/ˈɪntɝvʌl/","intervention":"/ˌɪntɝv ˈenʃʌn/","intimate":"/ˈɪntʌmʌt/","intricate":"/ˈɪntrʌkʌt/","intriguing":"/ˌɪntr ˈigɪŋ/","intrinsic":"/ˌɪntr ˈɪnsɪk/","intrude":"/ˌɪntr ˈud/","intuition":"/ˌɪntu ˈɪʃʌn/","invade":"/ˌɪnv ˈeɪd/","invent":"/ˌɪnv ˈent/","invest":"/ˌɪnv ˈest/","investigate":"/ˌɪnv ˈestʌg ˌeɪt/","involved":"/ˌɪnv ˈɑlvd/","irony":"/ˈaɪrʌni/","irrigation":"/ˌɪrʌg ˈeɪʃʌn/","irritate":"/ˈɪrɪt ˌeɪt/","isolated":"/ˈaɪsʌl ˌeɪtʌd/","jam":"/dʒ ˈæm/","jealous":"/dʒ ˈelʌs/","jewelry":"/dʒ ˈuʌlri/","judge":"/dʒ ˈʌdʒ/","junk":"/dʒ ˈʌŋk/","jury":"/dʒ ˈʊri/","justice":"/dʒ ˈʌstʌs/","juvenile":"/dʒ ˈuvʌnʌl/","keen":"/k ˈin/","kid":"/k ˈɪd/","kindergarten":"/k ˈɪndɝg ˌɑrtʌn/","kingdom":"/k ˈɪŋdʌm/","knit":"/n ˈɪt/","knowledge":"/n ˈɑlʌdʒ/","labor":"/l ˈeɪbɝ/","laboratory":"/l ˈæbrʌt ˌɔri/","lack":"/l ˈæk/","ladder":"/l ˈædɝ/","lag":"/l ˈæg/","lament":"/lʌm ˈent/","landmark":"/l ˈændm ˌɑrk/","landscape":"/l ˈændsk ˌeɪp/","lane":"/l ˈeɪn/","lap":"/l ˈæp/","largely":"/l ˈɑrdʒli/","lately":"/l ˈeɪtli/","latest":"/l ˈeɪtʌst/","latitude":"/l ˈætʌt ˌud/","latter":"/l ˈætɝ/","laughter":"/l ˈæftɝ/","launch":"/l ˈɔntʃ/","laundry":"/l ˈɔndri/","layer":"/l ˈeɪɝ/","lazy":"/l ˈeɪzi/","leak":"/l ˈik/","lean":"/l ˈin/","leap":"/l ˈip/","leather":"/l ˈeðɝ/","lecture":"/l ˈektʃɝ/","legacy":"/l ˈegʌsi/","legal":"/l ˈigʌl/","legend":"/l ˈedʒʌnd/","legislation":"/l ˌedʒʌsl ˈeɪʃʌn/","legitimate":"/lʌdʒ ˈɪtʌmʌt/","leisure":"/l ˈeʒɝ/","lest":"/l ˈest/","liable":"/l ˈaɪʌbʌl/","liberal":"/l ˈɪb ˌɝʌl/","lightning":"/l ˈaɪtnɪŋ/","likely":"/l ˈaɪkli/","limb":"/l ˈɪm/","linger":"/l ˈɪŋgɝ/","linguistic":"/lɪŋgw ˈɪstɪk/","literally":"/l ˈɪtɝʌli/","literature":"/l ˈɪtɝʌtʃɝ/","lively":"/l ˈaɪvli/","load":"/l ˈoʊd/","locate":"/l ˈoʊk ˌeɪt/","log":"/l ˈɔg/","logic":"/l ˈɑdʒɪk/","loose":"/l ˈus/","lord":"/l ˈɔrd/","loss":"/l ˈɔs/","lottery":"/l ˈɑtɝi/","loyal":"/l ˈɔɪʌl/","luggage":"/l ˈʌgʌdʒ/","lump":"/l ˈʌmp/","lung":"/l ˈʌŋ/","lure":"/l ˈʊr/","luxury":"/l ˈʌgʒɝi/","magnificent":"/mægn ˈɪfʌsʌnt/","majority":"/mʌdʒ ˈɔrʌti/","male":"/m ˈeɪl/","mammal":"/m ˈæmʌl/","mandatory":"/m ˈændʌt ˌɔri/","manifest":"/m ˈænʌf ˌest/","manipulate":"/mʌn ˈɪpjʌl ˌeɪt/","mankind":"/m ˈænk ˈaɪnd/","manual":"/m ˈænjuʌl/","manufacture":"/m ˌænjʌf ˈæktʃɝ/","margin":"/m ˈɑrdʒʌn/","marry":"/m ˈeri/","marvelous":"/m ˈɑrvʌlʌs/","mass":"/m ˈæs/","masterpiece":"/m ˈæstɝp ˌis/","match":"/m ˈætʃ/","mate":"/m ˈeɪt/","material":"/mʌt ˈɪriʌl/","mature":"/mʌtʃ ˈʊr/","mayor":"/m ˈeɪɝ/","meadow":"/m ˈed ˌoʊ/","meanwhile":"/m ˈinw ˌaɪl/","mechanism":"/m ˈekʌn ˌɪzʌm/","medical":"/m ˈedʌkʌl/","medieval":"/mɪd ˈivʌl/","meditation":"/m ˌedʌt ˈeɪʃʌn/","medium":"/m ˈidiʌm/","melancholy":"/m ˈelʌnk ˌɑli/","melt":"/m ˈelt/","menace":"/m ˈenʌs/","mental":"/m ˈentʌl/","mention":"/m ˈenʃʌn/","merchant":"/m ˈɝtʃʌnt/","mercy":"/m ˈɝsi/","merely":"/m ˈɪrli/","merge":"/m ˈɝdʒ/","merit":"/m ˈerʌt/","merry":"/m ˈeri/","mess":"/m ˈes/","metabolism":"/mʌt ˈæbʌl ˌɪzʌm/","metaphor":"/m ˈetʌfɔr/","method":"/m ˈeθʌd/","metropolitan":"/m ˌetrʌp ˈɑlʌtʌn/","microbe":"/m ˈaɪkr ˌoʊb/","midst":"/m ˈɪdst/","mighty":"/m ˈaɪti/","migrate":"/m ˈaɪgr ˌeɪt/","military":"/m ˈɪlʌt ˌeri/","millionaire":"/m ˌɪljʌn ˈer/","mine":"/m ˈaɪn/","minimum":"/m ˈɪnʌmʌm/","minister":"/m ˈɪnʌstɝ/","minor":"/m ˈaɪnɝ/","mischief":"/m ˈɪstʃʌf/","miserable":"/m ˈɪzɝʌbʌl/","misery":"/m ˈɪzɝi/","misleading":"/mɪsl ˈidɪŋ/","mission":"/m ˈɪʃʌn/","mistake":"/mɪst ˈeɪk/","mobile":"/m ˈoʊbʌl/","mock":"/m ˈɑk/","moderate":"/m ˈɑdɝʌt/","modest":"/m ˈɑdʌst/","modify":"/m ˈɑdʌf ˌaɪ/","moisture":"/m ˈɔɪstʃɝ/","mold":"/m ˈoʊld/","molecule":"/m ˈɑlʌkj ˌul/","monarch":"/m ˈɑn ˌɑrk/","monopoly":"/mʌn ˈɑpʌli/","monotonous":"/mʌn ˈɑtʌnʌs/","monument":"/m ˈɑnjumʌnt/","moral":"/m ˈɔrʌl/","moreover":"/mɔr ˈoʊvɝ/","mortality":"/mɔrt ˈælʌti/","mostly":"/m ˈoʊstli/","motive":"/m ˈoʊtɪv/","mount":"/m ˈaʊnt/","mourn":"/m ˈɔrn/","multiply":"/m ˈʌltʌpl ˌaɪ/","murder":"/m ˈɝdɝ/","murmur":"/m ˈɝmɝ/","muscle":"/m ˈʌsʌl/","muslim":"/m ˈʌzlʌm/","mutation":"/mjut ˈeɪʃʌn/","mutual":"/mj ˈutʃuʌl/","myth":"/m ˈɪθ/","naive":"/n ˌaɪ ˈiv/","naked":"/n ˈeɪkʌd/","namely":"/n ˈeɪmli/","nap":"/n ˈæp/","narrative":"/n ˈærʌtɪv/","narrow":"/n ˈeroʊ/","nasty":"/n ˈæsti/","nation":"/n ˈeɪʃʌn/","native":"/n ˈeɪtɪv/","naughty":"/n ˈɔti/","navigate":"/n ˈævʌg ˌeɪt/","navy":"/n ˈeɪvi/","nearly":"/n ˈɪrli/","neat":"/n ˈit/","necessarily":"/n ˌesʌs ˈerʌli/","negative":"/n ˈegʌtɪv/","neglect":"/nʌgl ˈekt/","negotiate":"/nʌg ˈoʊʃi ˌeɪt/","nephew":"/n ˈefju/","nervous":"/n ˈɝvʌs/","neuron":"/n ˈʊrɑn/","neutral":"/n ˈutrʌl/","nevertheless":"/n ˌevɝðʌl ˈes/","nightmare":"/n ˈaɪtm ˌer/","noble":"/n ˈoʊbʌl/","nod":"/n ˈɑd/","nor":"/n ˈɔr/","norm":"/n ˈɔrm/","notable":"/n ˈoʊtʌbʌl/","notice":"/n ˈoʊtʌs/","notion":"/n ˈoʊʃʌn/","notorious":"/noʊt ˈɔriʌs/","nourish":"/n ˈɝɪʃ/","novelty":"/n ˈɑvʌlti/","nuclear":"/n ˈukliɝ/","nuisance":"/n ˈusʌns/","numerous":"/n ˈumɝʌs/","nursing":"/n ˈɝsɪŋ/","nurture":"/n ˈɝtʃɝ/","nutrition":"/nutr ˈɪʃʌn/","obesity":"/oʊb ˈisʌti/","obey":"/oʊb ˈeɪ/","objective":"/ʌbdʒ ˈektɪv/","oblige":"/ʌbl ˈaɪdʒ/","obscure":"/ʌbskj ˈʊr/","obsessed":"/ʌbs ˈest/","obstacle":"/ˈɑbstʌkʌl/","obtain":"/ʌbt ˈeɪn/","obvious":"/ˈɑbviʌs/","occasion":"/ʌk ˈeɪʒʌn/","occasionally":"/ʌk ˈeɪʒʌnʌli/","occupation":"/ˌɑkjʌp ˈeɪʃʌn/","occupy":"/ˈɑkjʌp ˌaɪ/","occur":"/ʌk ˈɝ/","odd":"/ˈɑd/","odds":"/ˈɑdz/","offending":"/ʌf ˈendɪŋ/","offer":"/ˈɔfɝ/","official":"/ʌf ˈɪʃʌl/","offspring":"/ˈɔfspr ˌɪŋ/","omit":"/oʊm ˈɪt/","onset":"/ˈɑns ˌet/","operate":"/ˈɑpɝ ˌeɪt/","opponent":"/ʌp ˈoʊnʌnt/","opportunity":"/ˌɑpɝt ˈunʌti/","oppose":"/ʌp ˈoʊz/","oppress":"/ʌpr ˈes/","optimistic":"/ˌɑptʌm ˈɪstɪk/","option":"/ˈɑpʃʌn/","oral":"/ˈɔrʌl/","orbit":"/ˈɔrbʌt/","organ":"/ˈɔrgʌn/","organism":"/ˈɔrgʌn ˌɪzʌm/","organization":"/ˌɔrgʌnʌz ˈeɪʃʌn/","oriented":"/ˈɔri ˌentʌd/","origin":"/ˈɔrʌdʒʌn/","orphan":"/ˈɔrfʌn/","ought":"/ˈɔt/","outbreak":"/ˈaʊtbr ˌeɪk/","outcome":"/ˈaʊtk ˌʌm/","outlet":"/ˈaʊtl ˌet/","outlook":"/ˈaʊtl ˌʊk/","output":"/ˈaʊtp ˌʊt/","outraged":"/ˈaʊtr ˌeɪdʒd/","outstanding":"/ˌaʊtst ˈændɪŋ/","overall":"/ˈoʊvɝ ˌɔl/","overcome":"/ˈoʊvɝk ˌʌm/","overlook":"/ˈoʊvɝl ˌʊk/","overnight":"/ˈoʊvɝn ˈaɪt/","overtake":"/ˈoʊvɝt ˌeɪk/","overwhelming":"/ˌoʊvɝw ˈelmɪŋ/","owe":"/ˈoʊ/","owing":"/ˈoʊɪŋ/","own":"/ˈoʊn/","oxygen":"/ˈɑksʌdʒʌn/","pain":"/p ˈeɪn/","palace":"/p ˈælʌs/","pale":"/p ˈeɪl/","paradigm":"/p ˈerʌd ˌaɪm/","paradox":"/p ˈerʌd ˌɑks/","parallel":"/p ˈerʌl ˌel/","paralyzed":"/p ˈerʌl ˌaɪzd/","parasite":"/p ˈerʌs ˌaɪt/","pardon":"/p ˈɑrdʌn/","participate":"/pɑrt ˈɪsʌp ˌeɪt/","particle":"/p ˈɑrtʌkʌl/","particular":"/pɝt ˈɪkjʌlɝ/","passage":"/p ˈæsʌdʒ/","passenger":"/p ˈæsʌndʒɝ/","passion":"/p ˈæʃʌn/","passive":"/p ˈæsɪv/","patch":"/p ˈætʃ/","patent":"/p ˈætʌnt/","path":"/p ˈæθ/","patient":"/p ˈeɪʃʌnt/","patriotic":"/p ˌeɪtri ˈɑtɪk/","pause":"/p ˈɔz/","pavement":"/p ˈeɪvmʌnt/","peasant":"/p ˈezʌnt/","peculiar":"/pʌkj ˈuljɝ/","pedestrian":"/pʌd ˈestriʌn/","peer":"/p ˈɪr/","penalty":"/p ˈenʌlti/","penetrate":"/p ˈenʌtr ˌeɪt/","pension":"/p ˈenʃʌn/","per capita":"/p ˈɝ k ˈæpɪtʌ/","perceive":"/pɝs ˈiv/","perform":"/pɝf ˈɔrm/","peril":"/p ˈerʌl/","period":"/p ˈɪriʌd/","permanent":"/p ˈɝmʌnʌnt/","permit":"/pɝm ˈɪt/","perpetual":"/pɝp ˈetʃuʌl/","persist":"/pɝs ˈɪst/","personnel":"/p ˌɝsʌn ˈel/","perspective":"/pɝsp ˈektɪv/","persuade":"/pɝsw ˈeɪd/","pesticide":"/p ˈestʌs ˌaɪd/","petroleum":"/pʌtr ˈoʊliʌm/","phase":"/f ˈeɪz/","phenomenon":"/fʌn ˈɑmʌn ˌɑn/","philosophy":"/fʌl ˈɑsʌfi/","physical":"/f ˈɪzɪkʌl/","physician":"/fʌz ˈɪʃʌn/","physiological":"/f ˌɪziʌl ˈɑdʒɪkʌl/","pierce":"/p ˈɪrs/","pile":"/p ˈaɪl/","pill":"/p ˈɪl/","pioneer":"/p ˌaɪʌn ˈɪr/","plague":"/pl ˈeɪg/","plain":"/pl ˈeɪn/","planet":"/pl ˈænʌt/","plantation":"/pl ˌænt ˈeɪʃʌn/","plead":"/pl ˈid/","pleasant":"/pl ˈezʌnt/","pledge":"/pl ˈedʒ/","plenty":"/pl ˈenti/","plot":"/pl ˈɑt/","plow":"/pl ˈaʊ/","plunge":"/pl ˈʌndʒ/","poison":"/p ˈɔɪzʌn/","poke":"/p ˈoʊk/","pole":"/p ˈoʊl/","policy":"/p ˈɑlʌsi/","polish":"/p ˈɑlɪʃ/","polite":"/pʌl ˈaɪt/","political":"/pʌl ˈɪtʌkʌl/","poll":"/p ˈoʊl/","pollution":"/pʌl ˈuʃʌn/","population":"/p ˌɑpjʌl ˈeɪʃʌn/","portion":"/p ˈɔrʃʌn/","portray":"/pɔrtr ˈeɪ/","positive":"/p ˈɑzʌtɪv/","possess":"/pʌz ˈes/","possibly":"/p ˈɑsʌbli/","postpone":"/poʊstp ˈoʊn/","posture":"/p ˈɑstʃɝ/","potent":"/p ˈoʊtʌnt/","potential":"/pʌt ˈenʃʌl/","pour":"/p ˈɔr/","poverty":"/p ˈɑvɝti/","practical":"/pr ˈæktʌkʌl/","praise":"/pr ˈeɪz/","pray":"/pr ˈeɪ/","preach":"/pr ˈitʃ/","precaution":"/prik ˈɔʃʌn/","precede":"/prɪs ˈid/","precious":"/pr ˈeʃʌs/","precisely":"/prɪs ˈaɪsli/","predator":"/pr ˈedʌtɝ/","predecessor":"/pr ˈedʌs ˌesɝ/","predict":"/prɪd ˈɪkt/","predominantly":"/pr ˌɪd ˈɑmʌnʌntl ˌi/","prefer":"/prʌf ˈɝ/","pregnant":"/pr ˈegnʌnt/","prejudice":"/pr ˈedʒʌdɪs/","premise":"/pr ˈemɪs/","preoccupied":"/pri ˈɑkjʌp ˌaɪd/","prepare":"/prip ˈer/","prescribe":"/prʌskr ˈaɪb/","preserve":"/prʌz ˈɝv/","prestige":"/prest ˈiʒ/","presume":"/prɪz ˈum/","pretend":"/prit ˈend/","prevail":"/prɪv ˈeɪl/","prevent":"/prɪv ˈent/","previous":"/pr ˈiviʌs/","prey":"/pr ˈeɪ/","priest":"/pr ˈist/","primate":"/pr ˈaɪm ˌeɪt/","prime":"/pr ˈaɪm/","primitive":"/pr ˈɪmʌtɪv/","principal":"/pr ˈɪnsʌpʌl/","principle":"/pr ˈɪnsʌpʌl/","prior":"/pr ˈaɪɝ/","priority":"/praɪ ˈɔrʌti/","prison":"/pr ˈɪzʌn/","private":"/pr ˈaɪvʌt/","privilege":"/pr ˈɪvlʌdʒ/","probably":"/pr ˈɑbʌbl ˌi/","probe":"/pr ˈoʊb/","procedure":"/prʌs ˈidʒɝ/","proceed":"/prʌs ˈid/","proclaim":"/proʊkl ˈeɪm/","produce":"/prʌd ˈus/","profession":"/prʌf ˈeʃʌn/","professor":"/prʌf ˈesɝ/","proficiency":"/prʌf ˈɪʃʌnsi/","profile":"/pr ˈoʊf ˌaɪl/","profit":"/pr ˈɑfʌt/","profound":"/proʊf ˈaʊnd/","progress":"/pr ˈɑgr ˌes/","prohibit":"/proʊh ˈɪbʌt/","project":"/pr ˈɑdʒekt/","prolong":"/prʌl ˈɔŋ/","prominent":"/pr ˈɑmʌnʌnt/","promising":"/pr ˈɑmʌsɪŋ/","promote":"/prʌm ˈoʊt/","prompt":"/pr ˈɑmpt/","prone":"/pr ˈoʊn/","pronounce":"/prʌn ˈaʊns/","proper":"/pr ˈɑpɝ/","property":"/pr ˈɑpɝti/","prophet":"/pr ˈɑfʌt/","proportion":"/prʌp ˈɔrʃʌn/","propose":"/prʌp ˈoʊz/","prose":"/pr ˈoʊz/","prospect":"/pr ˈɑspekt/","prosperity":"/prɑsp ˈerʌti/","protect":"/prʌt ˈekt/","protein":"/pr ˈoʊt ˌin/","protest":"/pr ˈoʊt ˌest/","protocol":"/pr ˈoʊtʌk ˌɑl/","prove":"/pr ˈuv/","proverb":"/pr ˈɑvɝb/","provide":"/prʌv ˈaɪd/","province":"/pr ˈɑvʌns/","provoke":"/prʌv ˈoʊk/","psychiatrist":"/sʌk ˈaɪʌtrʌst/","psychology":"/saɪk ˈɑlʌdʒi/","publicity":"/pʌbl ˈɪsʌti/","publish":"/p ˈʌblɪʃ/","punctual":"/p ˈʌŋktʃuʌl/","punish":"/p ˈʌnɪʃ/","purchase":"/p ˈɝtʃʌs/","pure":"/pj ˈʊr/","purpose":"/p ˈɝpʌs/","purse":"/p ˈɝs/","pursue":"/pɝs ˈu/","puzzle":"/p ˈʌzʌl/","qualify":"/kw ˈɑlʌf ˌaɪ/","quality":"/kw ˈɑlʌti/","quantity":"/kw ˈɑntʌti/","quarrel":"/kw ˈɔrʌl/","quarter":"/kw ˈɔrtɝ/","quest":"/kw ˈest/","queue":"/kj ˈu/","quit":"/kw ˈɪt/","quote":"/kw ˈoʊt/","racial":"/r ˈeɪʃʌl/","radiation":"/r ˌeɪdi ˈeɪʃʌn/","radical":"/r ˈædʌkʌl/","rag":"/r ˈæg/","rage":"/r ˈeɪdʒ/","raise":"/r ˈeɪz/","random":"/r ˈændʌm/","range":"/r ˈeɪndʒ/","rank":"/r ˈæŋk/","rapid":"/r ˈæpʌd/","rare":"/r ˈer/","rate":"/r ˈeɪt/","ratio":"/r ˈeɪʃi ˌoʊ/","rational":"/r ˈæʃʌnʌl/","rattle":"/r ˈætʌl/","raw":"/r ˈɑ/","ray":"/r ˈeɪ/","reach":"/r ˈitʃ/","react":"/ri ˈækt/","ready":"/r ˈedi/","realize":"/r ˈiʌl ˌaɪz/","realm":"/r ˈelm/","reap":"/r ˈip/","reasonable":"/r ˈizʌnʌbʌl/","reassure":"/r ˌiʌʃ ˈʊr/","rebel":"/r ˈebʌl/","recall":"/r ˈik ˌɔl/","recent":"/r ˈisʌnt/","reception":"/rɪs ˈepʃʌn/","recession":"/rɪs ˈeʃʌn/","recipe":"/r ˈesʌpi/","recite":"/rʌs ˈaɪt/","reckless":"/r ˈeklʌs/","recognize":"/r ˈekʌgn ˌaɪz/","recollection":"/r ˌekʌl ˈekʃʌn/","recommend":"/r ˌekʌm ˈend/","reconcile":"/r ˈekʌns ˌaɪl/","recover":"/rɪk ˈʌvɝ/","recruit":"/rʌkr ˈut/","reduce":"/rʌd ˈus/","refer":"/rʌf ˈɝ/","refine":"/rʌf ˈaɪn/","reflect":"/rɪfl ˈekt/","reform":"/rʌf ˈɔrm/","refrain":"/rɪfr ˈeɪn/","refreshing":"/rɪfr ˈeʃɪŋ/","refugee":"/r ˈefjudʒi/","refuse":"/rʌfj ˈuz/","regard":"/rɪg ˈɑrd/","regardless":"/rʌg ˈɑrdlʌs/","region":"/r ˈidʒʌn/","register":"/r ˈedʒɪstɝ/","regret":"/rʌgr ˈet/","regulate":"/r ˈegjʌl ˌeɪt/","reign":"/r ˈeɪn/","reinforce":"/r ˌiɪnf ˈɔrs/","reject":"/rɪdʒ ˈekt/","rejoice":"/rɪdʒ ˈɔɪs/","relate":"/rɪl ˈeɪt/","relative":"/r ˈelʌtɪv/","relatively":"/r ˈelʌtɪvli/","release":"/ril ˈis/","relevant":"/r ˈelʌvʌnt/","religion":"/rɪl ˈɪdʒʌn/","reluctant":"/rɪl ˈʌktʌnt/","rely":"/rɪl ˈaɪ/","remain":"/rɪm ˈeɪn/","remark":"/rɪm ˈɑrk/","remarkable":"/rɪm ˈɑrkʌbʌl/","remedy":"/r ˈemʌdi/","remind":"/rim ˈaɪnd/","remote":"/rɪm ˈoʊt/","remove":"/rim ˈuv/","render":"/r ˈendɝ/","renowned":"/rɪn ˈaʊnd/","rent":"/r ˈent/","repair":"/rɪp ˈer/","replace":"/r ˌipl ˈeɪs/","reply":"/rɪpl ˈaɪ/","represent":"/r ˌeprɪz ˈent/","reproduce":"/r ˌiprʌd ˈus/","republic":"/rip ˈʌblʌk/","reputation":"/r ˌepjʌt ˈeɪʃʌn/","require":"/r ˌikw ˈaɪɝ/","rescue":"/r ˈeskju/","research":"/ris ˈɝtʃ/","resemble":"/rɪz ˈembʌl/","resent":"/rɪz ˈent/","reserve":"/rɪz ˈɝv/","resident":"/r ˈezɪdʌnt/","resign":"/rɪz ˈaɪn/","resist":"/rɪz ˈɪst/","resolve":"/riz ˈɑlv/","resort":"/rɪz ˈɔrt/","resource":"/r ˈisɔrs/","respectable":"/rɪsp ˈektʌbʌl/","respiratory":"/r ˈespɝʌt ˌɔri/","respond":"/rɪsp ˈɑnd/","responsibility":"/risp ˌɑnsʌb ˈɪlʌti/","restless":"/r ˈestlʌs/","restore":"/rɪst ˈɔr/","restrain":"/ristr ˈeɪn/","restrict":"/ristr ˈɪkt/","result":"/rɪz ˈʌlt/","resume":"/rɪz ˈum/","retail":"/r ˈit ˌeɪl/","retain":"/rɪt ˈeɪn/","retire":"/rɪt ˈaɪr/","retreat":"/ritr ˈit/","retrieve":"/rɪtr ˈiv/","reveal":"/rɪv ˈil/","revenge":"/riv ˈendʒ/","revenue":"/r ˈevʌn ˌu/","reverse":"/rɪv ˈɝs/","review":"/r ˌivj ˈu/","revise":"/rɪv ˈaɪz/","revive":"/rɪv ˈaɪv/","revolution":"/r ˌevʌl ˈuʃʌn/","reward":"/rɪw ˈɔrd/","rhetoric":"/r ˈetɝɪk/","rid":"/r ˈɪd/","riddle":"/r ˈɪdʌl/","ridiculous":"/rɪd ˈɪkjʌlʌs/","rigid":"/r ˈɪdʒʌd/","riot":"/r ˈaɪʌt/","risk":"/r ˈɪsk/","ritual":"/r ˈɪtʃuʌl/","roam":"/r ˈoʊm/","roar":"/r ˈɔr/","rob":"/r ˈɑb/","role":"/r ˈoʊl/","rotate":"/r ˈoʊt ˌeɪt/","rotten":"/r ˈɑtʌn/","rough":"/r ˈʌf/","routine":"/rut ˈin/","row":"/r ˈoʊ/","rub":"/r ˈʌb/","rude":"/r ˈud/","ruin":"/r ˈuʌn/","rumor":"/r ˈumɝ/","rural":"/r ˈʊrʌl/","rush":"/r ˈʌʃ/","rust":"/r ˈʌst/","sacred":"/s ˈeɪkrʌd/","sacrifice":"/s ˈækrʌf ˌaɪs/","saint":"/s ˈeɪnt/","sanitation":"/s ˌænʌt ˈeɪʃʌn/","satellite":"/s ˈætʌl ˌaɪt/","satisfy":"/s ˈætʌsf ˌaɪ/","savage":"/s ˈævʌdʒ/","scarcely":"/sk ˈersli/","scare":"/sk ˈer/","scatter":"/sk ˈætɝ/","scene":"/s ˈin/","scent":"/s ˈent/","scheme":"/sk ˈim/","scholar":"/sk ˈɑlɝ/","scold":"/sk ˈoʊld/","scope":"/sk ˈoʊp/","score":"/sk ˈɔr/","scorn":"/sk ˈɔrn/","scratch":"/skr ˈætʃ/","screaming":"/skr ˈimɪŋ/","script":"/skr ˈɪpt/","sculpture":"/sk ˈʌlptʃɝ/","search":"/s ˈɝtʃ/","seat":"/s ˈit/","secondhand":"/s ˈekʌndh ˌænd/","secretary":"/s ˈekrʌt ˌeri/","security":"/sɪkj ˈʊrʌti/","seed":"/s ˈid/","seek":"/s ˈik/","seemingly":"/s ˈimɪŋli/","segment":"/s ˈegmʌnt/","seize":"/s ˈiz/","seldom":"/s ˈeldʌm/","select":"/sʌl ˈekt/","self-esteem":"/s ˈelf ʌst ˈim/","selfish":"/s ˈelfɪʃ/","senator":"/s ˈenʌtɝ/","senior":"/s ˈinjɝ/","sensation":"/sens ˈeɪʃʌn/","sensitive":"/s ˈensʌtɪv/","sentiment":"/s ˈentʌmʌnt/","sequence":"/s ˈikwʌns/","serious":"/s ˈɪriʌs/","service":"/s ˈɝvʌs/","session":"/s ˈeʃʌn/","severe":"/sʌv ˈɪr/","sew":"/s ˈoʊ/","sewage":"/s ˈuʌdʒ/","shade":"/ʃ ˈeɪd/","shake":"/ʃ ˈeɪk/","shallow":"/ʃ ˈæloʊ/","shape":"/ʃ ˈeɪp/","share":"/ʃ ˈer/","sharp":"/ʃ ˈɑrp/","shatter":"/ʃ ˈætɝ/","shed":"/ʃ ˈed/","sheer":"/ʃ ˈɪr/","shelf":"/ʃ ˈelf/","shelter":"/ʃ ˈeltɝ/","shift":"/ʃ ˈɪft/","shipping":"/ʃ ˈɪpɪŋ/","shortage":"/ʃ ˈɔrtʌdʒ/","shortcoming":"/ʃ ˈɔrtk ˌʌmɪŋ/","shrink":"/ʃr ˈɪŋk/","shrug":"/ʃr ˈʌg/","shy":"/ʃ ˈaɪ/","sigh":"/s ˈaɪ/","sight":"/s ˈaɪt/","sign":"/s ˈaɪn/","significant":"/sʌgn ˈɪfɪkʌnt/","silly":"/s ˈɪli/","similar":"/s ˈɪmʌlɝ/","simultaneously":"/s ˌaɪmʌlt ˈeɪniʌsli/","sin":"/s ˈɪn/","sincere":"/sɪns ˈɪr/","sinking":"/s ˈɪŋkɪŋ/","site":"/s ˈaɪt/","skeleton":"/sk ˈelʌtʌn/","skeptical":"/sk ˈeptʌkʌl/","skill":"/sk ˈɪl/","skip":"/sk ˈɪp/","skyscraper":"/sk ˈaɪskr ˌeɪpɝ/","slang":"/sl ˈæŋ/","slap":"/sl ˈæp/","slave":"/sl ˈeɪv/","slender":"/sl ˈendɝ/","slight":"/sl ˈaɪt/","smash":"/sm ˈæʃ/","snap":"/sn ˈæp/","soak":"/s ˈoʊk/","soaring":"/s ˈɔrɪŋ/","society":"/sʌs ˈaɪʌti/","soil":"/s ˈɔɪl/","solar":"/s ˈoʊlɝ/","sole":"/s ˈoʊl/","solid":"/s ˈɑlʌd/","solitary":"/s ˈɑlʌt ˌeri/","solve":"/s ˈɑlv/","somehow":"/s ˈʌmh ˌaʊ/","somewhat":"/s ˈʌmw ˈʌt/","soothe":"/s ˈuð/","sophisticated":"/sʌf ˈɪstʌk ˌeɪtɪd/","sore":"/s ˈɔr/","sorrow":"/s ˈɑroʊ/","sour":"/s ˈaʊɝ/","source":"/s ˈɔrs/","souvenir":"/s ˌuvʌn ˈɪr/","span":"/sp ˈæn/","specialize":"/sp ˈeʃʌl ˌaɪz/","species":"/sp ˈiʃiz/","specific":"/spʌs ˈɪfɪk/","specimen":"/sp ˈesʌmʌn/","spectacle":"/sp ˈektʌkʌl/","spectrum":"/sp ˈektrʌm/","speculate":"/sp ˈekjʌl ˌeɪt/","sphere":"/sf ˈɪr/","spill":"/sp ˈɪl/","spinal":"/sp ˈaɪnʌl/","spirit":"/sp ˈɪrʌt/","splendid":"/spl ˈendɪd/","split":"/spl ˈɪt/","spoil":"/sp ˈɔɪl/","spontaneous":"/spɑnt ˈeɪniʌs/","spouse":"/sp ˈaʊs/","spread":"/spr ˈed/","spur":"/sp ˈɝ/","squeeze":"/skw ˈiz/","stable":"/st ˈeɪbʌl/","stake":"/st ˈeɪk/","stalk":"/st ˈɔk/","standard":"/st ˈændɝd/","staple":"/st ˈeɪpʌl/","stare":"/st ˈer/","startle":"/st ˈɑrtʌl/","starve":"/st ˈɑrv/","statement":"/st ˈeɪtmʌnt/","statesman":"/st ˈeɪtsmʌn/","static":"/st ˈætɪk/","statistics":"/stʌt ˈɪstɪks/","statue":"/st ˈætʃ ˌu/","status":"/st ˈætʌs/","steady":"/st ˈedi/","steep":"/st ˈip/","steer":"/st ˈɪr/","stem":"/st ˈem/","stereotype":"/st ˈeriʌt ˌaɪp/","stiff":"/st ˈɪf/","stimulate":"/st ˈɪmjʌl ˌeɪt/","stir":"/st ˈɝ/","stock":"/st ˈɑk/","storm":"/st ˈɔrm/","straightforward":"/str ˈeɪtf ˈɔrwɝd/","strain":"/str ˈeɪn/","stranger":"/str ˈeɪndʒɝ/","strategy":"/str ˈætʌdʒi/","stream":"/str ˈim/","strength":"/str ˈeŋkθ/","stress":"/str ˈes/","stretch":"/str ˈetʃ/","strict":"/str ˈɪkt/","striking":"/str ˈaɪkɪŋ/","strip":"/str ˈɪp/","strive":"/str ˈaɪv/","stroke":"/str ˈoʊk/","stroll":"/str ˈoʊl/","structure":"/str ˈʌktʃɝ/","struggle":"/str ˈʌgʌl/","stubborn":"/st ˈʌbɝn/","stuff":"/st ˈʌf/","stumble":"/st ˈʌmbʌl/","stun":"/st ˈʌn/","stupid":"/st ˈupʌd/","subjective":"/sʌbdʒ ˈektɪv/","submit":"/sʌbm ˈɪt/","subordinate":"/sʌb ˈɔrdʌn ˌeɪt/","subscriber":"/sʌbskr ˈaɪbɝ/","subsequent":"/s ˈʌbsʌkwʌnt/","subsidy":"/s ˈʌbsɪdi/","substance":"/s ˈʌbstʌns/","substantial":"/sʌbst ˈænʃʌl/","substitute":"/s ˈʌbstʌt ˌut/","subtle":"/s ˈʌtʌl/","suburb":"/s ˈʌbɝb/","suck":"/s ˈʌk/","sue":"/s ˈu/","suffer":"/s ˈʌfɝ/","sufficient":"/sʌf ˈɪʃʌnt/","suggest":"/sʌdʒ ˈest/","suicide":"/s ˈuʌs ˌaɪd/","suit":"/s ˈut/","sum":"/s ˈʌm/","summit":"/s ˈʌmʌt/","summon":"/s ˈʌmʌn/","superficial":"/s ˌupɝf ˈɪʃʌl/","superior":"/sup ˈɪriɝ/","superstition":"/s ˌupɝst ˈɪʃʌn/","supervisor":"/s ˈupɝv ˌaɪzɝ/","supplement":"/s ˈʌplʌmʌnt/","supply":"/sʌpl ˈaɪ/","support":"/sʌp ˈɔrt/","suppose":"/sʌp ˈoʊz/","suppress":"/sʌpr ˈes/","supreme":"/sʌpr ˈim/","surface":"/s ˈɝfʌs/","surge":"/s ˈɝdʒ/","surgery":"/s ˈɝdʒɝi/","surpass":"/sɝp ˈæs/","surplus":"/s ˈɝplʌs/","surrender":"/sɝ ˈendɝ/","surround":"/sɝ ˈaʊnd/","surveillance":"/sɝv ˈeɪlʌns/","survey":"/sɝv ˈeɪ/","survive":"/sɝv ˈaɪv/","susceptible":"/sʌs ˈeptʌbʌl/","suspect":"/sʌsp ˈekt/","suspend":"/sʌsp ˈend/","sustain":"/sʌst ˈeɪn/","swear":"/sw ˈer/","sweat":"/sw ˈet/","sweep":"/sw ˈip/","swell":"/sw ˈel/","swift":"/sw ˈɪft/","sword":"/s ˈɔrd/","sympathy":"/s ˈɪmpʌθi/","symptom":"/s ˈɪmptʌm/","syndrome":"/s ˈɪndr ˌoʊm/","synthetic":"/sɪnθ ˈetɪk/","tackle":"/t ˈækʌl/","tactics":"/t ˈæktɪks/","tale":"/t ˈeɪl/","talent":"/t ˈælʌnt/","tame":"/t ˈeɪm/","tap":"/t ˈæp/","task":"/t ˈæsk/","taste":"/t ˈeɪst/","tax":"/t ˈæks/","tear":"/t ˈer/","tease":"/t ˈiz/","technique":"/tekn ˈik/","telescope":"/t ˈelʌsk ˌoʊp/","temper":"/t ˈempɝ/","temperament":"/t ˈemprʌmʌnt/","temperature":"/t ˈemprʌtʃɝ/","temporary":"/t ˈempɝ ˌeri/","tempt":"/t ˈempt/","tend":"/t ˈend/","tender":"/t ˈendɝ/","tension":"/t ˈenʃʌn/","terminal":"/t ˈɝmʌnʌl/","terrible":"/t ˈerʌbʌl/","terrific":"/tɝ ˈɪfɪk/","territory":"/t ˈerɪt ˌɔri/","testify":"/t ˈestʌf ˌaɪ/","text":"/t ˈekst/","textile":"/t ˈekst ˌaɪl/","theme":"/θ ˈim/","theory":"/θ ˈɪri/","therapy":"/θ ˈerʌpi/","thereby":"/ð ˈerb ˈaɪ/","therefore":"/ð ˈerf ˌɔr/","thermometer":"/θɝm ˈɑmʌtɝ/","thesis":"/θ ˈisʌs/","thief":"/θ ˈif/","thirsty":"/θ ˈɝsti/","thoroughly":"/θ ˈɝoʊli/","thread":"/θr ˈed/","threaten":"/θr ˈetʌn/","thrilled":"/θr ˈɪld/","thrive":"/θr ˈaɪv/","throughout":"/θru ˈaʊt/","thrust":"/θr ˈʌst/","thumb":"/θ ˈʌm/","thus":"/ð ˈʌs/","tide":"/t ˈaɪd/","tidy":"/t ˈaɪdi/","tight":"/t ˈaɪt/","timber":"/t ˈɪmbɝ/","tiny":"/t ˈaɪni/","tip":"/t ˈɪp/","tissue":"/t ˈɪsj ˌu/","token":"/t ˈoʊkʌn/","tolerate":"/t ˈɑlɝ ˌeɪt/","toll":"/t ˈoʊl/","tomb":"/t ˈum/","torture":"/t ˈɔrtʃɝ/","tough":"/t ˈʌf/","tourism":"/t ˈʊr ˌɪzʌm/","toxic":"/t ˈɑksɪk/","trace":"/tr ˈeɪs/","track":"/tr ˈæk/","trade":"/tr ˈeɪd/","tradition":"/trʌd ˈɪʃʌn/","tragedy":"/tr ˈædʒʌdi/","trail":"/tr ˈeɪl/","trait":"/tr ˈeɪt/","transaction":"/trænz ˈækʃʌn/","transfer":"/trænsf ˈɝ/","transform":"/trænsf ˈɔrm/","transition":"/trænz ˈɪʃʌn/","translate":"/trænzl ˈeɪt/","transmit":"/trænzm ˈɪt/","transparent":"/trænsp ˈerʌnt/","transplant":"/trænspl ˈænt/","transportation":"/tr ˌænspɝt ˈeɪʃʌn/","trap":"/tr ˈæp/","trash":"/tr ˈæʃ/","treasure":"/tr ˈeʒɝ/","treat":"/tr ˈit/","treaty":"/tr ˈiti/","tremble":"/tr ˈembʌl/","tremendous":"/trʌm ˈendʌs/","trend":"/tr ˈend/","trial":"/tr ˈaɪʌl/","tribe":"/tr ˈaɪb/","trigger":"/tr ˈɪgɝ/","trim":"/tr ˈɪm/","triumph":"/tr ˈaɪʌmf/","trivial":"/tr ˈɪviʌl/","troop":"/tr ˈup/","tropical":"/tr ˈɑpɪkʌl/","trust":"/tr ˈʌst/","tuition":"/tju ˈɪʃʌn/","tumor":"/t ˈumɝ/","tune":"/t ˈun/","twin":"/tw ˈɪn/","twist":"/tw ˈɪst/","typical":"/t ˈɪpʌkʌl/","tyranny":"/t ˈɪrʌni/","ugly":"/ˈʌgli/","ultimate":"/ˈʌltʌmʌt/","ultraviolet":"/ˌʌltrʌv ˈaɪʌlɪt/","uncover":"/ʌnk ˈʌvɝ/","undergo":"/ˌʌndɝg ˈoʊ/","underlying":"/ˌʌndɝl ˈaɪɪŋ/","undermine":"/ˈʌndɝm ˌaɪn/","undertake":"/ˈʌndɝt ˌeɪk/","undone":"/ʌnd ˈʌn/","uneasy":"/ʌn ˈizi/","union":"/j ˈunjʌn/","unit":"/j ˈunʌt/","unite":"/j ˈun ˌaɪt/","universe":"/j ˈunʌv ˌɝs/","unless":"/ʌnl ˈes/","unlike":"/ʌnl ˈaɪk/","up-to-date":"/ˈʌp t ˈu d ˈeɪt/","upright":"/ʌpr ˈaɪt/","upset":"/ʌps ˈet/","urban":"/ˈɝbʌn/","urge":"/ˈɝdʒ/","urgent":"/ˈɝdʒʌnt/","usage":"/j ˈusʌdʒ/","utilize":"/j ˈutʌl ˌaɪz/","utmost":"/ˈʌtm ˌoʊst/","utter":"/ˈʌtɝ/","utterly":"/ˈʌtɝli/","vacant":"/v ˈeɪkʌnt/","vacuum":"/v ˈækjum/","vague":"/v ˈeɪg/","vain":"/v ˈeɪn/","valid":"/v ˈælɪd/","value":"/v ˈælju/","vanish":"/v ˈænɪʃ/","vapor":"/v ˈeɪpɝ/","various":"/v ˈeriʌs/","vary":"/v ˈeri/","vast":"/v ˈæst/","vegetation":"/v ˌedʒʌt ˈeɪʃʌn/","vehicle":"/v ˈihɪkʌl/","vein":"/v ˈeɪn/","vending":"/v ˈendɪŋ/","venture":"/v ˈentʃɝ/","verbal":"/v ˈɝbʌl/","verge":"/v ˈɝdʒ/","version":"/v ˈɝʒʌn/","vertical":"/v ˈɝtɪkʌl/","vessel":"/v ˈesʌl/","via":"/v ˈaɪʌ/","victim":"/v ˈɪktʌm/","vigorous":"/v ˈɪgɝʌs/","violate":"/v ˈaɪʌleɪt/","violence":"/v ˈaɪʌlʌns/","virtually":"/v ˈɝtʃuʌli/","virtue":"/v ˈɝtʃu/","virus":"/v ˈaɪrʌs/","visible":"/v ˈɪzʌbʌl/","vital":"/v ˈaɪtʌl/","vivid":"/v ˈɪvʌd/","vocabulary":"/voʊk ˈæbjʌl ˌeri/","vocal":"/v ˈoʊkʌl/","volcano":"/vɑlk ˈeɪnoʊ/","volume":"/v ˈɑljum/","volunteer":"/v ˌɑlʌnt ˈɪr/","vote":"/v ˈoʊt/","vow":"/v ˈaʊ/","voyage":"/v ˈɔɪʌdʒ/","vulnerable":"/v ˈʌlnɝʌbʌl/","wage":"/w ˈeɪdʒ/","wander":"/w ˈɑndɝ/","ward":"/w ˈɔrd/","warn":"/w ˈɔrn/","warrior":"/w ˈɔriɝ/","wealth":"/w ˈelθ/","weapon":"/w ˈepʌn/","weave":"/w ˈiv/","web":"/w ˈeb/","weep":"/w ˈip/","weigh":"/w ˈeɪ/","weight":"/w ˈeɪt/","welfare":"/w ˈelf ˌer/","wheat":"/w ˈit/","wheel":"/w ˈil/","whereas":"/wer ˈæz/","whether":"/w ˈeðɝ/","whisper":"/w ˈɪspɝ/","whistle":"/w ˈɪsʌl/","wicked":"/w ˈɪkʌd/","widespread":"/w ˈaɪdspr ˈed/","wilderness":"/w ˈɪldɝnʌs/","wildlife":"/w ˈaɪldl ˌaɪf/","willing":"/w ˈɪlɪŋ/","wind":"/w ˈaɪnd/","wipe":"/w ˈaɪp/","wisdom":"/w ˈɪzdʌm/","wit":"/w ˈɪt/","witch":"/w ˈɪtʃ/","withdraw":"/wɪðdr ˈɔ/","wither":"/w ˈɪðɝ/","within":"/wɪð ˈɪn/","withstand":"/wɪθst ˈænd/","witness":"/w ˈɪtnʌs/","wonder":"/w ˈʌndɝ/","worm":"/w ˈɝm/","worry":"/w ˈɝi/","worship":"/w ˈɝʃʌp/","worth":"/w ˈɝθ/","wound":"/w ˈaʊnd/","wrecked":"/r ˈekt/","yard":"/j ˈɑrd/","yawn":"/j ˈɔn/","yearn":"/j ˈɝn/","yell":"/j ˈel/","youngster":"/j ˈʌŋstɝ/","youth":"/j ˈuθ/"};
function getWordPhonetic(word) {
  if (!word || !word.en) return '';
  return PHONETICS[String(word.en).toLowerCase().trim()] || '';
}

const WORDS = WORDS_RAW.map(([isNew, id, en, jp]) => ({ isNew, id, en, jp }));
const WORD_MAP = {};
WORDS.forEach(w => WORD_MAP[w.id] = w);

const SET_SIZE = 50;
const WRONG_THRESHOLD = 10;
const TOTAL_SETS = Math.ceil(WORDS.length / SET_SIZE);

// =========================================================
// STATE
// =========================================================
let progress = {}; // wordId → { q1, q2, q3 }
let bookmarks = new Set(); // bookmarked wordIds
let currentSetIdx = 0;
let selectedMode = 1;
let selectedRetest = 'all'; // 'all' | 'mix' | 'circle' | 'cross' | 'bookmark'
let selectedBmMode = 1;    // mode selector for bookmark screen
let selectedBmFilter = 'all'; // 'all' | 'bm' | 'wrong'
let normalQuizCount = 10;
let setQuizRanges = {}; // setIdx -> { startId, endId }
let bookmarkQuizCount = 10;
let quiz = null;

// =========================================================
// WORD VOICE / SPEECH SYNTHESIS
// =========================================================
const VOICE_AUTO_KEY = 'systan_voice_auto_enabled';
function isVoiceSupported() { return typeof window !== 'undefined' && 'speechSynthesis' in window; }
function isAutoVoiceEnabled() { return localStorage.getItem(VOICE_AUTO_KEY) === '1'; }
function setAutoVoiceEnabled(enabled) {
  localStorage.setItem(VOICE_AUTO_KEY, enabled ? '1' : '0');
  renderAccountSettings && renderAccountSettings();
}
function speakWordText(text, lang = 'en-US') {
  if (!text || !isVoiceSupported()) {
    alert('この端末では音声読み上げに対応していません。');
    return;
  }
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = lang;
    u.rate = 0.86;
    u.pitch = 1;
    u.volume = 1;
    const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
    const languagePrefix = lang.split('-')[0];
    const preferred = voices.find(v => v.lang.toLowerCase() === lang.toLowerCase()) ||
      voices.find(v => v.lang.toLowerCase().startsWith(languagePrefix.toLowerCase()));
    if (preferred) u.voice = preferred;
    window.speechSynthesis.speak(u);
  } catch (e) { console.warn('speech failed', e); }
}
function speakWordById(wordId, event) {
  if (event) event.stopPropagation();
  const w = WORDS.find(x => Number(x.id) === Number(wordId));
  if (w) speakWordText(w.en);
}
function speakCurrentQuizWord() {
  if (!quiz || !quiz.words || !quiz.words[quiz.idx]) return;
  const word = quiz.words[quiz.idx];
  const asksForEnglish = quiz.mode === 1;
  speakWordText(asksForEnglish ? word.en : word.jp, asksForEnglish ? 'en-US' : 'ja-JP');
}
function toggleAutoVoiceFromSettings() {
  const input = document.getElementById('voice-auto-toggle');
  setAutoVoiceEnabled(!!(input && input.checked));
}
function renderVoiceSettingsCard() {
  const checked = isAutoVoiceEnabled() ? 'checked' : '';
  const disabled = isVoiceSupported() ? '' : 'disabled';
  const help = isVoiceSupported() ? 'クイズで英単語が表示されたときに自動で読み上げます。' : 'このブラウザは音声読み上げに対応していません。';
  return `
    <div class="account-card voice-settings-card">
      <div class="ranking-meta-title">音声</div>
      <div class="voice-setting-row">
        <div>
          <div class="voice-setting-title">英単語の自動読み上げ</div>
          <div class="account-help">${help}</div>
        </div>
        <label class="voice-switch">
          <input id="voice-auto-toggle" type="checkbox" ${checked} ${disabled} onchange="toggleAutoVoiceFromSettings()">
          <span></span>
        </label>
      </div>
      <button class="btn btn-secondary voice-test-btn" onclick="speakWordText('example')">音声テスト</button>
    </div>`;
}

let leaderboardStats = { totalAnswered: 0, totalCorrect: 0, totalWrong: 0, updatedAt: null };
let leaderboardCache = [];
let myLeaderboardRank = null;
let accountProfile = { nickname: '' };
let profileAvatarData = '';
const NICKNAME_KEY = 'systan_public_nickname_v1';
const PROFILE_AVATAR_KEY_PREFIX = 'systan_profile_avatar_v1_';

const STATUS_RANK = { '◎': 4, '○': 3, '×': 2, null: 0, '': 0 };

function getWordProgress(id) {
  return progress[id] || { q1: null, q2: null, q3: null };
}

function getStatus(id) {
  const wp = getWordProgress(id);
  // Historical records have no order information; retain their previous display
  // until this word receives a new answer.
  if (['◎', '○', '×'].includes(wp.latestStatus)) return wp.latestStatus;
  const vals = [wp.q1, wp.q2, wp.q3];
  let best = 0;
  vals.forEach(v => { const r = STATUS_RANK[v] || 0; if (r > best) best = r; });
  if (best === 4) return '◎';
  if (best === 3) return '○';
  if (best === 2) return '×';
  return '';
}

function setQResult(id, qn, result) {
  if (!progress[id]) progress[id] = { q1: null, q2: null, q3: null };
  progress[id][qn] = result;
  if (['◎', '○', '×'].includes(result)) {
    progress[id].latestStatus = result;
    progress[id].latestAnsweredAt = Date.now();
  }
}

function getQProgress(id) {
  const wp = getWordProgress(id);
  return { q1: wp.q1 || '', q2: wp.q2 || '', q3: wp.q3 || '' };
}

function getSetWords(setIdx) {
  const start = setIdx * SET_SIZE;
  return WORDS.slice(start, start + SET_SIZE);
}

function getSetIdBounds(setIdx) {
  const words = getSetWords(setIdx);
  return {
    minId: words[0].id,
    maxId: words[words.length - 1].id
  };
}

function sanitizeSetRange(setIdx, startValue, endValue) {
  // Unit内に限定せず、全単語から自由に範囲指定できるようにする
  const minId = WORDS[0].id;
  const maxId = WORDS[WORDS.length - 1].id;
  let startId = Number(startValue);
  let endId = Number(endValue);

  if (!Number.isFinite(startId)) startId = minId;
  if (!Number.isFinite(endId)) endId = maxId;

  startId = Math.max(minId, Math.min(maxId, Math.floor(startId)));
  endId = Math.max(minId, Math.min(maxId, Math.floor(endId)));

  if (startId > endId) {
    const temp = startId;
    startId = endId;
    endId = temp;
  }

  return { startId, endId, minId, maxId };
}

function ensureSetRange(setIdx) {
  const stored = setQuizRanges[setIdx] || {};
  const safe = sanitizeSetRange(setIdx, stored.startId, stored.endId);
  setQuizRanges[setIdx] = { startId: safe.startId, endId: safe.endId };
  return safe;
}

function getRangedSetWords(setIdx) {
  const { startId, endId } = ensureSetRange(setIdx);
  // Unitをまたいだ範囲指定に対応
  return WORDS.filter(w => w.id >= startId && w.id <= endId);
}

function getSetStats(setIdx) {
  const words = getSetWords(setIdx);
  const counts = { '': 0, '○': 0, '◎': 0, '×': 0 };
  words.forEach(w => { const s = getStatus(w.id); counts[s] = (counts[s] || 0) + 1; });
  return counts;
}

function isSetCompleted(setIdx) {
  const words = getSetWords(setIdx);
  return words.every(w => getStatus(w.id) === '◎');
}

function getWrongWords() {
  return WORDS.filter(w => getStatus(w.id) === '×');
}

// =========================================================
// BOOKMARK HELPERS
// =========================================================
function isBookmarked(id) {
  return bookmarks.has(id);
}

function toggleBookmark(id) {
  if (bookmarks.has(id)) {
    bookmarks.delete(id);
  } else {
    bookmarks.add(id);
  }
  saveProgress();
}

function getBookmarkedWords() {
  return WORDS.filter(w => bookmarks.has(w.id));
}

function selectRetest(mode) {
  selectedRetest = mode;
  const select = document.getElementById('retest-select');
  if (select && select.value !== mode) select.value = mode;
  ['all','mix','circle','cross','bookmark'].forEach(m => {
    const btn = document.getElementById('retest-btn-' + m);
    if (btn) btn.classList.toggle('active', m === mode);
  });
  renderSet();
}

function normalizeResultMark(value) {
  // 「○」と「〇」は見た目が近い別文字なので、判定前に統一する
  if (value === '〇') return '○';
  return value || null;
}

function getWordResultMarks(id) {
  const wp = getWordProgress(id);
  return [wp.q1, wp.q2, wp.q3].map(normalizeResultMark).filter(Boolean);
}

function hasAnyWordResult(id, targets) {
  const targetSet = new Set(targets.map(normalizeResultMark));
  return getWordResultMarks(id).some(result => targetSet.has(result));
}

function getActiveWords(setIdx) {
  const words = getRangedSetWords(setIdx);

  // 出題対象の仕様:
  // all      = すべて（未回答、○、×） ※◎は習得済みとして除外
  // mix      = ○、×
  // circle   = ○
  // cross    = ×
  // bookmark = 選択範囲内のブックマーク
  //
  // 判定は各問題形式(q1/q2/q3)の個別結果ではなく、画面に表示している
  // 総合ステータス(getStatus)に統一する。これによりプルダウン表示と
  // 実際の出題対象がズレない。
  if (selectedRetest === 'all') {
    return words.filter(w => {
      const status = getStatus(w.id);
      return status === '' || status === '○' || status === '×';
    });
  }

  if (selectedRetest === 'mix') {
    return words.filter(w => {
      const status = getStatus(w.id);
      return status === '○' || status === '×';
    });
  }

  if (selectedRetest === 'circle') {
    return words.filter(w => getStatus(w.id) === '○');
  }

  if (selectedRetest === 'cross') {
    return words.filter(w => getStatus(w.id) === '×');
  }

  if (selectedRetest === 'bookmark') {
    return words.filter(w => bookmarks.has(w.id));
  }

  return words;
}

function getTotalStats() {
  const counts = { '': 0, '○': 0, '◎': 0, '×': 0 };
  WORDS.forEach(w => { const s = getStatus(w.id); counts[s] = (counts[s] || 0) + 1; });
  return counts;
}

// =========================================================
// LEADERBOARD
// =========================================================

function showSyncStatus(message, isError = false) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', !!isError);
  el.classList.add('show');
  clearTimeout(showSyncStatus._timer);
  showSyncStatus._timer = setTimeout(() => el.classList.remove('show'), 1800);
}

function getInitials(name) {
  const txt = String(name || '').trim();
  if (!txt) return 'G';
  return txt.replace(/\s+/g, '').slice(0, 1).toUpperCase();
}

function getAnonymousName(uid) {
  const raw = String(uid || 'guest').replace(/[^a-zA-Z0-9]/g, '');
  const suffix = (raw.slice(-4) || '0000').toUpperCase();
  return `学習者-${suffix}`;
}

function getStoredNickname() {
  try { return (localStorage.getItem(NICKNAME_KEY) || '').trim(); } catch(e) { return ''; }
}

function setStoredNickname(name) {
  try {
    if (name) localStorage.setItem(NICKNAME_KEY, name);
    else localStorage.removeItem(NICKNAME_KEY);
  } catch(e) {}
}

function getPublicNickname(user = auth.currentUser) {
  const local = getStoredNickname();
  const remote = (accountProfile && accountProfile.nickname || '').trim();
  if (local) return local;
  if (remote) return remote;
  return user ? getAnonymousName(user.uid) : 'ゲスト';
}



function normalizeSchoolCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20);
}

function getSchoolCode() {
  try { return normalizeSchoolCode(localStorage.getItem(SCHOOL_CODE_KEY) || ''); } catch (e) { return ''; }
}

function getSchoolName() {
  try { return String(localStorage.getItem(SCHOOL_CODE_NAME_KEY) || '').trim(); } catch (e) { return ''; }
}

function getCachedSchoolLogo(code = getSchoolCode()) {
  if (!code) return '';
  try {
    const value = localStorage.getItem(SCHOOL_LOGO_KEY_PREFIX + normalizeSchoolCode(code)) || '';
    return value.length <= 260000 && /^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/.test(value) ? value : '';
  } catch (e) { return ''; }
}

function cacheSchoolLogo(code, value) {
  const normalized = normalizeSchoolCode(code);
  if (!normalized) return;
  try {
    if (typeof value === 'string' && value.length <= 260000 && /^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/.test(value)) {
      localStorage.setItem(SCHOOL_LOGO_KEY_PREFIX + normalized, value);
    } else {
      localStorage.removeItem(SCHOOL_LOGO_KEY_PREFIX + normalized);
    }
  } catch (e) { console.warn('Could not cache school logo:', e); }
}

function renderSchoolBranding() {
  const title = document.querySelector('.app-header .header-title');
  if (!title) return;
  const logo = getCachedSchoolLogo();
  if (logo) {
    title.innerHTML = `<img class="school-brand-logo" src="${logo}" alt="${escapeHtml(getSchoolName() || '学校ロゴ')}">`;
    title.setAttribute('aria-label', getSchoolName() || '学校ロゴ');
  } else {
    title.textContent = 'シス単マスター';
    title.removeAttribute('aria-label');
  }
}

async function refreshSchoolBranding() {
  const code = getSchoolCode();
  if (!code) { renderSchoolBranding(); return; }
  try {
    const snap = await db.collection('schoolCodes').doc(code).get();
    if (snap.exists) {
      const data = snap.data() || {};
      if (data.schoolName) setLocalSchoolCode(code, data.schoolName);
      cacheSchoolLogo(code, data.schoolLogoData || '');
    }
  } catch (e) { console.warn('refreshSchoolBranding error:', e); }
  renderSchoolBranding();
}

function setLocalSchoolCode(code, name = '') {
  const normalized = normalizeSchoolCode(code);
  try {
    if (normalized) localStorage.setItem(SCHOOL_CODE_KEY, normalized);
    else localStorage.removeItem(SCHOOL_CODE_KEY);
    if (name) localStorage.setItem(SCHOOL_CODE_NAME_KEY, String(name).trim().slice(0, 40));
    else localStorage.removeItem(SCHOOL_CODE_NAME_KEY);
  } catch (e) {}
  renderSchoolBranding();
}

const CLASS_SESSION_KEY = 'systan_class_session_v1';
let activeClassAssignment = null;
function normalizeClassId(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20);
}
function storeClassAssignment(assignment) {
  activeClassAssignment = assignment;
  try {
    if (assignment) localStorage.setItem(CLASS_SESSION_KEY, JSON.stringify(assignment));
    else localStorage.removeItem(CLASS_SESSION_KEY);
  } catch (e) {}
  renderClassStudyShortcut();
}
function restoreClassAssignment() {
  try {
    const saved = JSON.parse(localStorage.getItem(CLASS_SESSION_KEY) || 'null');
    if (saved && (saved.local === true || typeof saved.uid === 'string') && saved.schoolId === getSchoolCode() &&
      normalizeClassId(saved.classId) === saved.classId) {
      activeClassAssignment = saved;
    }
  } catch (e) {}
}
function renderClassStudyShortcut() {
  const slot = document.getElementById('home-class-study');
  if (!slot) return;
  const a = activeClassAssignment;
  const validSession = a && (a.local === true && !auth.currentUser || auth.currentUser && a.uid === auth.currentUser.uid);
  if (!a || !validSession || getSchoolCode() !== a.schoolId) {
    slot.innerHTML = '';
    return;
  }
  const hasRange = Number.isInteger(a.startId) && Number.isInteger(a.endId) && a.startId >= WORDS[0].id && a.endId <= WORDS[WORDS.length - 1].id && a.startId <= a.endId;
  slot.innerHTML = `<div class="class-study-card">
    <div class="class-study-kicker">今回の単語テスト範囲</div>
    <div class="class-study-heading">${escapeHtml(a.schoolName || a.schoolId)} · ${escapeHtml(a.className || a.classId)}</div>
    <div class="class-study-range">${hasRange ? `${a.startId}〜${a.endId}番 · ${a.endId - a.startId + 1}語` : 'テスト範囲はまだ設定されていません'}</div>
    ${hasRange ? '<button type="button" class="btn btn-primary class-study-button" onclick="startClassStudy()">この範囲で学習する →</button>' : ''}
  </div>`;
}
function startClassStudy() {
  const a = activeClassAssignment;
  if (!a || !(a.local === true && !auth.currentUser || auth.currentUser && a.uid === auth.currentUser.uid) ||
      !Number.isInteger(a.startId) || !Number.isInteger(a.endId)) return;
  currentSetIdx = 0;
  selectedRetest = 'all';
  setQuizRanges[0] = { startId: a.startId, endId: a.endId };
  showHome();
  const words = WORDS.filter(w => w.id >= a.startId && w.id <= a.endId);
  startQuizSession(shuffle(words), 'normal');
}

function showSchoolLoginMessage(message, error = false) {
  const el = document.getElementById('auth-school-message');
  if (el) { el.textContent = message; el.classList.toggle('error', error); }
  showSyncStatus(message, error);
}

function leaveLocalSchool() {
  if (!activeClassAssignment?.local) return;
  storeClassAssignment(null);
  setLocalSchoolCode('', '');
  showHome();
}

async function loginSchoolClass() {
  const schoolId = normalizeSchoolCode(document.getElementById('auth-school-id')?.value);
  const classId = normalizeClassId(document.getElementById('auth-class-id')?.value);
  if (!schoolId) { showSchoolLoginMessage('学校IDを入力してください', true); return; }
  const button = document.getElementById('auth-school-login');
  if (button) button.disabled = true;
  showSchoolLoginMessage('学校IDを確認しています…');
  try {
    const schoolSnap = await db.collection('schoolCodes').doc(schoolId).get();
    if (!schoolSnap.exists || schoolSnap.data()?.active === false) throw new Error('学校IDが見つからないか、停止中です');
    const schoolData = schoolSnap.data() || {};
    let classData = null;
    if (classId) {
      const classSnap = await db.collection('schoolCodes').doc(schoolId).collection('classes').doc(classId).get();
      if (!classSnap.exists || classSnap.data()?.active === false) {
        throw new Error('クラスIDを確認できません。学校IDのみでログインするか、管理者にクラス登録を依頼してください');
      }
      classData = classSnap.data();
    }
    const rangeData = classData || schoolData;
    const startId = Number(rangeData.startId), endId = Number(rangeData.endId);
    const validRange = Number.isInteger(startId) && Number.isInteger(endId) &&
      startId >= WORDS[0].id && endId <= WORDS[WORDS.length - 1].id && startId <= endId;
    let local = false;
    if (!auth.currentUser) {
      try { await auth.signInAnonymously(); }
      catch (error) {
        // A verified school may still use device-local learning when Anonymous Auth is disabled.
        console.warn('Anonymous Auth unavailable; using local school session:', error);
        local = true;
      }
    }
    const schoolName = String(schoolData.schoolName || '').slice(0,40);
    cacheSchoolLogo(schoolId, schoolData.schoolLogoData || '');
    setLocalSchoolCode(schoolId, schoolName);
    storeClassAssignment({uid:auth.currentUser?.uid || null,local,schoolId,classId,
      startId:validRange ? startId : null,endId:validRange ? endId : null,
      schoolName,className:String(classData?.className || '').slice(0,40)});
    if (auth.currentUser && !await saveSchoolCodeToProfile(schoolId, schoolName)) throw new Error('school_profile_link_failed');
    closeAuthModal();
    markWelcomeAccepted();
    showHome();
    showSchoolLoginMessage(local ? '学校IDを確認しました。学習履歴はこの端末に保存されます' :
      (validRange ? '学校・クラスでログインしました' : '学校に参加しました。テスト範囲は未設定です'));
  } catch (e) {
    console.warn('loginSchoolClass error:', e);
    if (e.message === 'school_profile_link_failed') {
      storeClassAssignment(null);
      await loadSchoolCodeFromProfile();
    }
    showSchoolLoginMessage(e.message === 'school_profile_link_failed' ? '学校とアカウントを紐づけできませんでした。現在の所属を確認してください。' :
      (e.code === 'permission-denied' ? '学校・クラスの設定を取得できませんでした。時間をおいて再度お試しください。' :
      '学校IDを確認できませんでした。入力内容をご確認ください。'), true);
  } finally { if (button) button.disabled = false; }
}

async function refreshClassTestRange() {
  const a = activeClassAssignment;
  if (!a || !(a.local === true && !auth.currentUser || auth.currentUser && a.uid === auth.currentUser.uid) || !navigator.onLine) return;
  try {
    const schoolSnap = await db.collection('schoolCodes').doc(a.schoolId).get();
    if (!schoolSnap.exists || schoolSnap.data()?.active === false) { storeClassAssignment(null); return; }
    let data = schoolSnap.data();
    if (a.classId) {
      const snap = await db.collection('schoolCodes').doc(a.schoolId).collection('classes').doc(a.classId).get();
      if (!snap.exists || snap.data()?.active === false) { storeClassAssignment(null); return; }
      data = snap.data();
    }
    const startId = Number(data.startId), endId = Number(data.endId);
    const valid = Number.isInteger(startId) && Number.isInteger(endId) && startId >= WORDS[0].id &&
      endId <= WORDS[WORDS.length-1].id && startId <= endId;
    storeClassAssignment({ ...a, startId:valid ? startId : null, endId:valid ? endId : null,
      className:a.classId ? String(data.className || '').slice(0,40) : '' });
  } catch(e) { console.warn('refreshClassTestRange error:',e); }
}

async function saveClassTestRange() {
  if (!isSchoolAdmin()) { showSyncStatus('管理者のみ設定できます', true); return; }
  const schoolId = normalizeSchoolCode(document.getElementById('admin-class-school')?.value);
  const classId = normalizeClassId(document.getElementById('admin-class-id')?.value);
  const className = String(document.getElementById('admin-class-name')?.value || '').trim().slice(0,40);
  const startId = Number(document.getElementById('admin-class-start')?.value);
  const endId = Number(document.getElementById('admin-class-end')?.value);
  if (!schoolId || !Number.isInteger(startId) || !Number.isInteger(endId) ||
    startId < WORDS[0].id || endId > WORDS[WORDS.length - 1].id || startId > endId) {
    showSyncStatus('学校ID・クラスIDと正しい単語範囲を入力してください', true); return;
  }
  try {
    const school = await db.collection('schoolCodes').doc(schoolId).get();
    if (!school.exists || school.data()?.active === false) throw new Error('先に有効な学校IDを発行してください');
    if (classId) {
      await db.collection('schoolCodes').doc(schoolId).collection('classes').doc(classId).set({
        classId,className,startId,endId,active:true,
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      },{merge:true});
    } else {
      await db.collection('schoolCodes').doc(schoolId).set({startId,endId,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
    }
    showSyncStatus(`${schoolId}${classId ? ' / ' + classId : ''}：${startId}〜${endId}番を保存しました`);
  } catch(e) { console.warn('saveClassTestRange error:',e); showSyncStatus(e.message || '範囲を保存できませんでした',true); }
}

function isSchoolAdmin(user = auth.currentUser) {
  if (!user) return false;
  const email = String(user.email || '').toLowerCase();
  const uid = String(user.uid || '');
  return ADMIN_UIDS.includes(uid) || ADMIN_EMAILS.map(v => String(v).toLowerCase()).includes(email);
}

async function getUserManagementProfile(user = auth.currentUser) {
  if (!user) return {};
  try {
    const snap = await db.collection('users').doc(user.uid).get();
    return snap.exists ? (snap.data() || {}) : {};
  } catch (e) {
    console.warn('getUserManagementProfile error:', e);
    return {};
  }
}

function getLocalUserRole(profile = null, user = auth.currentUser) {
  if (isSchoolAdmin(user)) return 'admin';
  return String((profile && profile.role) || 'user').trim() || 'user';
}

async function isTeacherUser(user = auth.currentUser) {
  if (!user) return false;
  if (isSchoolAdmin(user)) return true;
  const profile = await getUserManagementProfile(user);
  return String(profile.role || '').trim() === 'teacher';
}

function showSuspendedOverlay() {
  let el = document.getElementById('suspended-account-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'suspended-account-overlay';
    el.className = 'suspended-overlay';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="suspended-card">
      <div class="suspended-icon">⛔</div>
      <h1>利用停止中</h1>
      <p>${escapeHtml(USER_SUSPENDED_MESSAGE)}</p>
      <button class="btn btn-secondary" onclick="location.reload()">再読み込み</button>
    </div>`;
  el.classList.add('show');
}

function hideSuspendedOverlay() {
  const el = document.getElementById('suspended-account-overlay');
  if (el) el.classList.remove('show');
}

function showRoleAccessMessage(title, message, showLogin = false) {
  const body = document.getElementById('role-page-body');
  if (!body) return;
  body.innerHTML = `
    <div class="role-access-card">
      <div class="role-access-icon">🔒</div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <div class="role-access-actions">
        ${showLogin ? '<button class="btn btn-primary" onclick="showAuthModal()">ログインする</button>' : ''}
        <button class="btn btn-secondary" onclick="location.href='./index.html'">ホームへ戻る</button>
      </div>
    </div>`;
}

async function initRolePage(pageType) {
  const loading = document.getElementById('loading-screen');
  if (loading) loading.style.display = 'none';
  renderAuthFab();

  const user = await waitForAuthReady(3500);
  if (!user) {
    showRoleAccessMessage('ログインが必要です', 'このページはアクセス許可を持つユーザーのみ利用できます。', true);
    return;
  }

  const profile = await getUserManagementProfile(user);
  if (profile.disabledInApp === true && !isSchoolAdmin(user)) {
    showSuspendedOverlay();
    try { await auth.signOut(); } catch (e) {}
    showRoleAccessMessage('利用停止中', USER_SUSPENDED_MESSAGE, false);
    return;
  }

  if (pageType === 'admin') {
    if (!isSchoolAdmin(user)) {
      showRoleAccessMessage('管理者専用ページです', '管理者権限を持つアカウントのみアクセスできます。', false);
      return;
    }
    const body = document.getElementById('role-page-body');
    if (body) body.innerHTML = '<div id="admin-dashboard-body" class="admin-dashboard-body"></div>';
    await loadAdminDashboard();
    return;
  }

  if (pageType === 'teacher') {
    const role = getLocalUserRole(profile, user);
    if (role !== 'teacher' && role !== 'admin') {
      showRoleAccessMessage('先生専用ページです', '先生または管理者に設定されたアカウントのみアクセスできます。', false);
      return;
    }
    await loadTeacherDashboard(profile);
  }
}

async function loadTeacherDashboard(profile = {}) {
  const body = document.getElementById('role-page-body');
  if (!body) return;
  body.innerHTML = '<div class="school-muted">先生用データを読み込み中...</div>';
  try {
    const schoolCode = normalizeSchoolCode(profile.schoolCode || getSchoolCode() || '');
    const usersQuery = schoolCode
      ? db.collection('users').where('schoolCode', '==', schoolCode).limit(500).get().catch(() => null)
      : Promise.resolve(null);
    const [rankingSnap, usersSnap, codesSnap] = await Promise.all([
      (schoolCode ? db.collection('rankings').where('schoolCode', '==', schoolCode) : Promise.resolve(null)),
      usersQuery,
      db.collection('schoolCodes').limit(200).get().catch(() => null)
    ]);
    let rankingRows = rankingSnap && rankingSnap.docs ? rankingSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) : [];
    let userRows = usersSnap && usersSnap.docs ? usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) : [];
    if (schoolCode) {
      rankingRows = rankingRows.filter(row => normalizeSchoolCode(row.schoolCode) === schoolCode);
      userRows = userRows.filter(row => normalizeSchoolCode(row.schoolCode) === schoolCode);
    }
    rankingRows.sort((a,b) =>
      (Number(b.mastered || 0) - Number(a.mastered || 0)) ||
      (Number(b.totalCorrect || 0) - Number(a.totalCorrect || 0)) ||
      (Number(b.accuracy || 0) - Number(a.accuracy || 0))
    );
    const activeCodes = codesSnap && codesSnap.docs ? codesSnap.docs.filter(doc => (doc.data() || {}).active !== false).length : 0;
    body.innerHTML = `
      <div class="admin-hero teacher-hero">
        <div>
          <div class="admin-hero-kicker">TEACHER DASHBOARD</div>
          <div class="admin-hero-title">先生用ページ</div>
          <div class="admin-hero-sub">${schoolCode ? escapeHtml(schoolCode) + ' の' : ''}学習状況を確認できます。設定変更は管理者ページのみ可能です。</div>
        </div>
        <button class="admin-refresh-btn" onclick="loadTeacherDashboard()">↻ 更新</button>
      </div>
      <div class="admin-dashboard-grid admin-stat-grid-new">
        <div class="admin-stat"><div class="admin-stat-icon">👥</div><div class="admin-stat-value">${userRows.length}</div><div class="admin-stat-label">登録ユーザー</div></div>
        <div class="admin-stat"><div class="admin-stat-icon">🏆</div><div class="admin-stat-value">${rankingRows.length}</div><div class="admin-stat-label">ランキング参加者</div></div>
        <div class="admin-stat"><div class="admin-stat-icon">🔑</div><div class="admin-stat-value">${activeCodes}</div><div class="admin-stat-label">有効コード</div></div>
      </div>
      <section class="admin-panel">
        <div class="admin-panel-head"><div><div class="admin-section-title">学習ランキング</div><div class="admin-card-sub">先生権限では閲覧のみできます。</div></div></div>
        <div class="teacher-ranking-list">
          ${rankingRows.slice(0, 50).map((row, i) => `<div class="teacher-row"><strong>#${i + 1}</strong><span>${escapeHtml(getPublicRankingName(row))}</span><span>◎ ${Number(row.mastered || 0)}</span><span>正答率 ${Number(row.accuracy || 0).toFixed(1)}%</span></div>`).join('') || '<div class="school-muted">まだランキングデータがありません。</div>'}
        </div>
      </section>
      <section class="admin-panel">
        <div class="admin-panel-head"><div><div class="admin-section-title">ユーザー一覧</div><div class="admin-card-sub">利用停止やロール変更は管理者ページで行います。</div></div></div>
        <div class="teacher-user-list">
          ${userRows.slice(0, 100).map(row => `<div class="teacher-row"><span>${escapeHtml(row.profileNickname || row.publicName || row.nickname || '名前未設定')}</span><span>${escapeHtml(row.email || 'メール未取得')}</span><span>${escapeHtml(row.role || 'user')}</span><span>${row.disabledInApp ? '停止中' : '有効'}</span></div>`).join('') || '<div class="school-muted">ユーザー情報がありません。</div>'}
        </div>
      </section>`;
  } catch (e) {
    console.warn('loadTeacherDashboard error:', e);
    body.innerHTML = '<div class="role-access-card"><h1>読み込みに失敗しました</h1><p>時間をおいて再度お試しください。</p></div>';
  }
}

async function saveSchoolCodeToProfile(code, name = '') {
  if (!auth.currentUser) return true;
  try {
    await db.collection('users').doc(auth.currentUser.uid).set({
      schoolCode: normalizeSchoolCode(code) || null,
      schoolName: name || null,
      schoolCodeUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await syncLeaderboardProfile();
    return true;
  } catch (e) {
    console.warn('saveSchoolCodeToProfile error:', e);
    return false;
  }
}

async function loadSchoolCodeFromProfile() {
  if (!auth.currentUser) return;
  try {
    const uid = auth.currentUser.uid;
    const snap = await db.collection('users').doc(uid).get();
    const data = snap.exists ? (snap.data() || {}) : {};
    if (data.schoolCode) setLocalSchoolCode(data.schoolCode, data.schoolName || '');
    else setLocalSchoolCode('', '');
    await refreshSchoolBranding();
  } catch (e) {
    console.warn('loadSchoolCodeFromProfile error:', e);
  }
}

async function joinSchoolCode() {
  const input = document.getElementById('school-code-input');
  const code = normalizeSchoolCode(input ? input.value : '');
  if (!code) {
    showSyncStatus('参加コードを入力してください', true);
    return;
  }
  let name = '';
  try {
    const snap = await db.collection('schoolCodes').doc(code).get();
    if (!snap.exists) {
      showSyncStatus('この参加コードはまだ発行されていません', true);
      return;
    }
    const data = snap.data() || {};
    if (data.active === false) {
      showSyncStatus('この参加コードは停止中です', true);
      return;
    }
    name = String(data.schoolName || data.name || '').trim();
    cacheSchoolLogo(code, data.schoolLogoData || '');
  } catch (e) {
    console.warn('joinSchoolCode validation error:', e);
    showSyncStatus('参加コードを確認できませんでした', true);
    return;
  }
  if (auth.currentUser && !await saveSchoolCodeToProfile(code, name)) {
    showSyncStatus('この学校をアカウントに登録できませんでした。現在の所属を確認してください', true);
    return;
  }
  setLocalSchoolCode(code, name);
  await fetchLeaderboard();
  renderHomeRankingPanel();
  renderAccountSettings();
  if (document.getElementById('screen-ranking')?.classList.contains('active')) renderRanking();
  showSyncStatus(`${name ? name + 'に' : ''}参加しました`);
}

async function clearSchoolCode() {
  if (auth.currentUser && !await saveSchoolCodeToProfile('', '')) {
    showSyncStatus('学校との紐づけを解除できませんでした', true);
    return;
  }
  setLocalSchoolCode('', '');
  storeClassAssignment(null);
  await fetchLeaderboard();
  renderHomeRankingPanel();
  renderAccountSettings();
  if (document.getElementById('screen-ranking')?.classList.contains('active')) renderRanking();
  showSyncStatus('学校コードを解除しました');
}

function makeSchoolCodeSuggestion() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function fillSchoolCodeSuggestion() {
  const input = document.getElementById('admin-school-code-input');
  if (input) input.value = makeSchoolCodeSuggestion();
}

async function issueSchoolCode() {
  if (!auth.currentUser) {
    showSyncStatus('管理者ログインが必要です', true);
    return;
  }
  if (!isSchoolAdmin()) {
    showSyncStatus('参加コードを発行できるのは管理者のみです', true);
    return;
  }
  const nameEl = document.getElementById('admin-school-name-input');
  const codeEl = document.getElementById('admin-school-code-input');
  const schoolName = String(nameEl ? nameEl.value : '').trim().slice(0, 40);
  const code = normalizeSchoolCode(codeEl ? codeEl.value : '');
  if (!schoolName) {
    showSyncStatus('学校名を入力してください', true);
    return;
  }
  if (!code || code.length < 4) {
    showSyncStatus('参加コードは4文字以上で入力してください', true);
    return;
  }
  try {
    const ref = db.collection('schoolCodes').doc(code);
    const existing = await ref.get();
    if (existing.exists) {
      showSyncStatus('この参加コードはすでに使われています', true);
      return;
    }
    await ref.set({
      code,
      schoolName,
      active: true,
      createdByUid: auth.currentUser.uid,
      createdByEmail: auth.currentUser.email || '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (codeEl) codeEl.value = code;
    showSyncStatus(`参加コード「${code}」を発行しました`);
    await loadIssuedSchoolCodes();
  } catch (e) {
    console.warn('issueSchoolCode error:', e);
    showSyncStatus('参加コードを発行できませんでした。時間をおいて再度お試しください', true);
  }
}

async function saveSchoolLogo(input) {
  const file = input?.files?.[0];
  const code = normalizeSchoolCode(document.getElementById('admin-school-logo-code')?.value);
  if (!file) return;
  if (!isSchoolAdmin() || !auth.currentUser) {
    showSyncStatus('学校ロゴの変更は管理者のみ行えます', true);
    input.value = '';
    return;
  }
  if (!code) {
    showSyncStatus('学校IDを入力してください', true);
    input.value = '';
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    showSyncStatus('JPEG・PNG・WebP形式の5MB以下の画像を選んでください', true);
    input.value = '';
    return;
  }
  try {
    const schoolRef = db.collection('schoolCodes').doc(code);
    const schoolSnap = await schoolRef.get();
    if (!schoolSnap.exists) throw new Error('school_not_found');
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 480 / bitmap.width, 220 / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const logo = canvas.toDataURL('image/webp', 0.78);
    if (logo.length > 240000) throw new Error('school_logo_too_large');
    await schoolRef.update({ schoolLogoData: logo, schoolLogoUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    cacheSchoolLogo(code, logo);
    if (code === getSchoolCode()) renderSchoolBranding();
    showSyncStatus('学校ロゴを保存しました');
  } catch (e) {
    console.warn('saveSchoolLogo error:', e);
    showSyncStatus(e.message === 'school_not_found' ? '学校IDが見つかりません' : '学校ロゴを保存できませんでした', true);
  } finally { input.value = ''; }
}

async function removeSchoolLogo() {
  const code = normalizeSchoolCode(document.getElementById('admin-school-logo-code')?.value);
  if (!isSchoolAdmin() || !auth.currentUser || !code) {
    showSyncStatus('管理者アカウントと学校IDを確認してください', true);
    return;
  }
  try {
    await db.collection('schoolCodes').doc(code).update({ schoolLogoData: firebase.firestore.FieldValue.delete() });
    cacheSchoolLogo(code, '');
    renderSchoolBranding();
    showSyncStatus('学校ロゴを削除しました');
  } catch (e) {
    console.warn('removeSchoolLogo error:', e);
    showSyncStatus('学校ロゴを削除できませんでした', true);
  }
}

async function loadIssuedSchoolCodes() {
  const list = document.getElementById('admin-school-code-list');
  if (!list) return;
  if (!auth.currentUser || !isSchoolAdmin()) {
    list.innerHTML = '<div class="school-muted">管理者ログイン時のみ発行済みコードを表示します。</div>';
    return;
  }
  try {
    const snap = await db.collection('schoolCodes').orderBy('createdAt', 'desc').limit(20).get();
    if (snap.empty) {
      list.innerHTML = '<div class="school-muted">まだ発行済みコードはありません。</div>';
      return;
    }
    list.innerHTML = snap.docs.map(doc => {
      const data = doc.data() || {};
      const active = data.active !== false;
      return `<div class="school-code-item">
        <div><div class="school-code-main">${escapeHtml(doc.id)}</div><div class="school-code-sub">${escapeHtml(data.schoolName || '学校名なし')} ／ ${active ? '有効' : '停止中'}</div></div>
        <button class="school-small-btn" onclick="toggleSchoolCodeActive('${escapeHtml(doc.id)}', ${active ? 'false' : 'true'})">${active ? '停止' : '有効化'}</button>
      </div>`;
    }).join('');
  } catch (e) {
    console.warn('loadIssuedSchoolCodes error:', e);
    list.innerHTML = '<div class="school-muted">発行済みコードを取得できませんでした。</div>';
  }
}

async function toggleSchoolCodeActive(code, active) {
  if (!auth.currentUser || !isSchoolAdmin()) {
    showSyncStatus('管理者のみ変更できます', true);
    return;
  }
  try {
    await db.collection('schoolCodes').doc(normalizeSchoolCode(code)).set({
      active: !!active,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    showSyncStatus(active ? '参加コードを有効化しました' : '参加コードを停止しました');
    await loadIssuedSchoolCodes();
  } catch (e) {
    console.warn('toggleSchoolCodeActive error:', e);
    showSyncStatus('変更に失敗しました', true);
  }
}


async function deleteSchoolCode(code) {
  if (!auth.currentUser || !isSchoolAdmin()) {
    showSyncStatus('管理者のみ削除できます', true);
    return;
  }
  const normalized = normalizeSchoolCode(code);
  if (!normalized) return;
  if (!confirm(`参加コード「${normalized}」を削除しますか？参加中ユーザーの表示には影響する場合があります。`)) return;
  try {
    await db.collection('schoolCodes').doc(normalized).delete();
    showSyncStatus('参加コードを削除しました');
    await loadAdminDashboard();
    await loadIssuedSchoolCodes();
  } catch (e) {
    console.warn('deleteSchoolCode error:', e);
    showSyncStatus('削除に失敗しました', true);
  }
}



// =========================================================
// PWA INSTALL SUPPORT
// =========================================================
function isInstalledPwa() {
  return !!(
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.startsWith('android-app://')
  );
}

function buildAdminUserRows(usersSnap, rankingSnap) {
  const map = new Map();
  try {
    if (rankingSnap && rankingSnap.docs) {
      rankingSnap.docs.forEach(doc => {
        const data = doc.data() || {};
        map.set(doc.id, {
          id: doc.id,
          uid: data.uid || doc.id,
          email: data.email || '',
          profileNickname: data.profileNickname || data.nickname || data.name || '',
          publicName: data.publicName || data.nickname || data.name || '',
          schoolCode: data.schoolCode || '',
          schoolName: data.schoolName || '',
          role: data.role || 'user',
          disabledInApp: data.disabledInApp === true,
          note: data.note || '',
          done: Number(data.done || 0),
          mastered: Number(data.mastered || 0),
          totalAnswered: Number(data.totalAnswered || 0),
          accuracy: Number(data.accuracy || 0),
          source: 'ranking'
        });
      });
    }
    if (usersSnap && usersSnap.docs) {
      usersSnap.docs.forEach(doc => {
        const data = doc.data() || {};
        const prev = map.get(doc.id) || { id: doc.id, uid: doc.id, source: 'user' };
        map.set(doc.id, {
          ...prev,
          id: doc.id,
          uid: data.uid || prev.uid || doc.id,
          email: data.email || prev.email || '',
          profileNickname: data.profileNickname || data.nickname || prev.profileNickname || prev.publicName || '',
          publicName: data.publicName || prev.publicName || data.profileNickname || data.nickname || '',
          schoolCode: data.schoolCode || prev.schoolCode || '',
          schoolName: data.schoolName || prev.schoolName || '',
          role: data.role || prev.role || 'user',
          disabledInApp: data.disabledInApp === true,
          note: data.note || prev.note || '',
          source: prev.source === 'ranking' ? 'user+ranking' : 'user'
        });
      });
    }
  } catch (e) {
    console.warn('buildAdminUserRows error:', e);
  }
  return Array.from(map.values()).sort((a, b) => {
    if ((b.totalAnswered || 0) !== (a.totalAnswered || 0)) return (b.totalAnswered || 0) - (a.totalAnswered || 0);
    return String(a.profileNickname || a.email || a.uid).localeCompare(String(b.profileNickname || b.email || b.uid), 'ja');
  });
}

function renderAdminUserRows(rows) {
  if (!rows || !rows.length) return '<div class="school-muted admin-empty">登録ユーザー情報はまだありません。</div>';
  return rows.map(row => {
    const uid = escapeHtml(row.id || row.uid || '');
    const nick = escapeHtml(row.profileNickname || row.publicName || '');
    const email = escapeHtml(row.email || 'メール未取得');
    const schoolCode = escapeHtml(normalizeSchoolCode(row.schoolCode || ''));
    const schoolName = escapeHtml(row.schoolName || '');
    const role = escapeHtml(row.role || 'user');
    const note = escapeHtml(row.note || '');
    const suspended = row.disabledInApp === true;
    const stats = `回答 ${Number(row.totalAnswered || 0)}問 ／ 習得 ${Number(row.mastered || 0)}語 ／ 正答率 ${Number(row.accuracy || 0)}%`;
    return `<div class="admin-user-row" data-admin-user-row data-search="${uid} ${email} ${nick} ${schoolCode} ${schoolName} ${role}">
      <div class="admin-user-summary">
        <div class="admin-user-avatar">${suspended ? '⛔' : '👤'}</div>
        <div>
          <div class="admin-user-name">${nick || '名前未設定'} <span class="admin-pill ${suspended ? 'off' : 'on'}">${suspended ? '停止中' : '有効'}</span></div>
          <div class="admin-user-sub">${email} ／ UID: <span class="admin-mono">${uid}</span></div>
          <div class="admin-user-sub">${escapeHtml(stats)}</div>
        </div>
      </div>
      <div class="admin-user-edit-grid">
        <label class="admin-field"><span>表示名</span><input id="admin-user-nick-${uid}" class="account-input" maxlength="24" value="${nick}" placeholder="表示名"></label>
        <label class="admin-field"><span>学校コード</span><input id="admin-user-school-code-${uid}" class="account-input" maxlength="20" value="${schoolCode}" placeholder="ABC123"></label>
        <label class="admin-field"><span>学校名</span><input id="admin-user-school-name-${uid}" class="account-input" maxlength="40" value="${schoolName}" placeholder="学校名・クラス名"></label>
        <label class="admin-field"><span>権限</span><select id="admin-user-role-${uid}" class="account-input"><option value="user" ${role === 'user' ? 'selected' : ''}>一般</option><option value="teacher" ${role === 'teacher' ? 'selected' : ''}>先生</option><option value="admin" ${role === 'admin' ? 'selected' : ''}>管理者メモ</option></select></label>
        <label class="admin-field admin-user-note-field"><span>管理メモ</span><input id="admin-user-note-${uid}" class="account-input" maxlength="80" value="${note}" placeholder="任意メモ"></label>
      </div>
      <div class="admin-user-actions">
        <button class="btn btn-primary" onclick="saveAdminUserProfile('${uid}')">変更を保存</button>
        <button class="btn btn-secondary" onclick="toggleAdminUserSuspended('${uid}', ${suspended ? 'false' : 'true'})">${suspended ? '利用停止を解除' : '利用停止にする'}</button>
        <button class="school-small-btn danger" onclick="deleteAdminUserAppData('${uid}')">アプリ情報を削除</button>
      </div>
    </div>`;
  }).join('');
}

function filterAdminUserRows() {
  const q = String(document.getElementById('admin-user-search')?.value || '').trim().toLowerCase();
  document.querySelectorAll('[data-admin-user-row]').forEach(row => {
    const hay = String(row.getAttribute('data-search') || '').toLowerCase();
    row.style.display = !q || hay.includes(q) ? '' : 'none';
  });
}

async function saveAdminUserProfile(uid) {
  if (!auth.currentUser || !isSchoolAdmin()) {
    showSyncStatus('管理者のみ変更できます', true);
    return;
  }
  const safeUid = String(uid || '').trim();
  if (!safeUid) return;
  const nickname = String(document.getElementById(`admin-user-nick-${safeUid}`)?.value || '').trim().slice(0, 24);
  const schoolCode = normalizeSchoolCode(document.getElementById(`admin-user-school-code-${safeUid}`)?.value || '');
  const schoolName = String(document.getElementById(`admin-user-school-name-${safeUid}`)?.value || '').trim().slice(0, 40);
  const role = String(document.getElementById(`admin-user-role-${safeUid}`)?.value || 'user').trim().slice(0, 20);
  const note = String(document.getElementById(`admin-user-note-${safeUid}`)?.value || '').trim().slice(0, 80);
  try {
    const payload = {
      uid: safeUid,
      profileNickname: nickname || null,
      publicName: nickname || null,
      schoolCode: schoolCode || null,
      schoolName: schoolName || null,
      role: role || 'user',
      note: note || null,
      updatedByUid: auth.currentUser.uid,
      updatedByEmail: auth.currentUser.email || '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('users').doc(safeUid).set(payload, { merge: true });
    await db.collection('rankings').doc(safeUid).set({
      nickname: nickname || null,
      name: nickname || null,
      schoolCode: schoolCode || null,
      schoolName: schoolName || null,
      updatedByUid: auth.currentUser.uid,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    showSyncStatus('ユーザー情報を保存しました');
    await loadAdminDashboard();
  } catch (e) {
    console.warn('saveAdminUserProfile error:', e);
    showSyncStatus('ユーザー情報の保存に失敗しました', true);
  }
}

async function toggleAdminUserSuspended(uid, disabled) {
  if (!auth.currentUser || !isSchoolAdmin()) {
    showSyncStatus('管理者のみ変更できます', true);
    return;
  }
  const safeUid = String(uid || '').trim();
  if (!safeUid) return;
  try {
    await db.collection('users').doc(safeUid).set({
      disabledInApp: !!disabled,
      disabledUpdatedByUid: auth.currentUser.uid,
      disabledUpdatedByEmail: auth.currentUser.email || '',
      disabledUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await db.collection('rankings').doc(safeUid).set({ disabledInApp: !!disabled }, { merge: true });
    showSyncStatus(disabled ? 'ユーザーを利用停止にしました' : '利用停止を解除しました');
    await loadAdminDashboard();
  } catch (e) {
    console.warn('toggleAdminUserSuspended error:', e);
    showSyncStatus('利用停止状態の変更に失敗しました', true);
  }
}

async function deleteAdminUserAppData(uid) {
  if (!auth.currentUser || !isSchoolAdmin()) {
    showSyncStatus('管理者のみ変更できます', true);
    return;
  }
  const safeUid = String(uid || '').trim();
  if (!safeUid) return;
  if (!confirm('このユーザーのアプリ内プロフィールとランキング情報を削除します。Firebase Authenticationのログインアカウント自体は削除されません。よろしいですか？')) return;
  try {
    await Promise.all([
      db.collection('users').doc(safeUid).delete().catch(() => null),
      db.collection('rankings').doc(safeUid).delete().catch(() => null)
    ]);
    showSyncStatus('アプリ内ユーザー情報を削除しました');
    await loadAdminDashboard();
  } catch (e) {
    console.warn('deleteAdminUserAppData error:', e);
    showSyncStatus('削除に失敗しました', true);
  }
}

async function enforceUserSuspendedState(user) {
  if (!user || isSchoolAdmin(user)) return false;
  try {
    const snap = await db.collection('users').doc(user.uid).get();
    const data = snap.exists ? (snap.data() || {}) : {};
    if (data.disabledInApp === true) {
      showSuspendedOverlay();
      showSyncStatus(USER_SUSPENDED_MESSAGE, true);
      await auth.signOut();
      return true;
    }
    hideSuspendedOverlay();
  } catch (e) {
    console.warn('enforceUserSuspendedState error:', e);
  }
  return false;
}

async function loadAdminDashboard() {
  const wrap = document.getElementById('admin-dashboard-body');
  if (!wrap) return;
  if (!auth.currentUser || !isSchoolAdmin()) {
    wrap.innerHTML = '<div class="school-muted">管理者ログイン時のみダッシュボードを表示します。</div>';
    return;
  }
  wrap.innerHTML = '<div class="school-muted">管理者データを読み込み中...</div>';
  try {
    const [codesSnap, rankingSnap, settingsSnap, usersSnap] = await Promise.all([
      db.collection('schoolCodes').orderBy('createdAt', 'desc').limit(100).get(),
      db.collection('rankings').limit(500).get(),
      db.collection('appSettings').doc('global').get().catch(() => null),
      db.collection('users').limit(500).get().catch(() => null)
    ]);
    const rankingRows = rankingSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const codeRows = codesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const joinedCounts = {};
    rankingRows.forEach(row => {
      const c = normalizeSchoolCode(row.schoolCode);
      if (c) joinedCounts[c] = (joinedCounts[c] || 0) + 1;
    });
    const activeCount = codeRows.filter(row => row.active !== false).length;
    const schoolParticipants = Object.values(joinedCounts).reduce((a, b) => a + b, 0);
    const settings = settingsSnap && settingsSnap.exists ? (settingsSnap.data() || {}) : {};
    const userRows = buildAdminUserRows(usersSnap, rankingSnap);
    const suspendedUserCount = userRows.filter(row => row.disabledInApp === true).length;
    wrap.innerHTML = `
      <div class="admin-hero">
        <div>
          <div class="admin-hero-kicker">ADMIN DASHBOARD</div>
          <div class="admin-hero-title">管理者メニュー</div>
          <div class="admin-hero-sub">学校コード・ユーザー・メンテナンスを管理できます。</div>
        </div>
        <button class="admin-refresh-btn" onclick="loadAdminDashboard()">↻ 更新</button>
      </div>

      <div class="admin-dashboard-grid admin-stat-grid-new">
        <div class="admin-stat"><div class="admin-stat-icon">🔑</div><div class="admin-stat-value">${codeRows.length}</div><div class="admin-stat-label">発行コード</div></div>
        <div class="admin-stat"><div class="admin-stat-icon">✅</div><div class="admin-stat-value">${activeCount}</div><div class="admin-stat-label">有効コード</div></div>
        <div class="admin-stat"><div class="admin-stat-icon">🏆</div><div class="admin-stat-value">${rankingRows.length}</div><div class="admin-stat-label">ランキング参加者</div></div>
        <div class="admin-stat"><div class="admin-stat-icon">🏫</div><div class="admin-stat-value">${schoolParticipants}</div><div class="admin-stat-label">学校コード参加者</div></div>
        <div class="admin-stat"><div class="admin-stat-icon">👥</div><div class="admin-stat-value">${userRows.length}</div><div class="admin-stat-label">登録ユーザー</div></div>
        <div class="admin-stat"><div class="admin-stat-icon">⛔</div><div class="admin-stat-value">${suspendedUserCount}</div><div class="admin-stat-label">停止中</div></div>
      </div>

      <div class="admin-panel-grid">
        <section class="admin-panel admin-panel-maintenance">
          <div class="admin-panel-head">
            <div>
              <div class="admin-section-title">公開状態</div>
              <h3>メンテナンス</h3>
            </div>
            <span class="admin-state-badge ${settings.maintenanceMode ? 'danger' : 'safe'}">${settings.maintenanceMode ? 'ON' : 'OFF'}</span>
          </div>
          <div class="admin-maintenance-panel ${settings.maintenanceMode ? 'is-on' : 'is-off'}">
            <div>
              <div class="admin-maintenance-title">現在：${settings.maintenanceMode ? 'メンテナンス中' : '通常公開中'}</div>
              <div class="school-muted">${settings.maintenanceMode ? '一般ユーザーはメンテナンス画面に移動します。' : '一般ユーザーは通常どおり利用できます。'}</div>
            </div>
            <div class="admin-maintenance-actions">
              <button class="btn btn-review" onclick="setMaintenanceModeOneTap(true)" ${settings.maintenanceMode ? 'disabled' : ''}>ONにする</button>
              <button class="btn btn-secondary" onclick="setMaintenanceModeOneTap(false)" ${settings.maintenanceMode ? '' : 'disabled'}>OFFにする</button>
            </div>
          </div>
        </section>

      </div>

      <section class="admin-panel admin-list-panel admin-user-panel">
        <div class="admin-panel-head">
          <div>
            <div class="admin-section-title">ユーザー管理</div>
            <h3>登録ユーザー情報</h3>
          </div>
        </div>
        <div class="admin-note">メールアドレス・パスワードそのものはFirebase Authentication側で管理されるため、この画面ではアプリ内プロフィール・学校コード・権限・利用停止状態を変更します。</div>
        <div class="admin-user-toolbar">
          <input id="admin-user-search" class="account-input" placeholder="名前・メール・UID・学校コードで検索" oninput="filterAdminUserRows()">
          <button class="btn btn-secondary" onclick="filterAdminUserRows()">検索</button>
        </div>
        <div class="admin-user-list" id="admin-user-list">
          ${renderAdminUserRows(userRows)}
        </div>
      </section>

      <section class="admin-panel admin-list-panel">
        <div class="admin-panel-head">
          <div>
            <div class="admin-section-title">学校コード</div>
            <h3>コード別参加状況</h3>
          </div>
        </div>
        <div class="admin-code-dashboard-list">
          ${codeRows.length ? codeRows.map(row => {
            const active = row.active !== false;
            const count = joinedCounts[row.id] || 0;
            return `<div class="admin-code-row admin-list-row">
              <div>
                <div class="school-code-main">${escapeHtml(row.id)} <span class="admin-pill ${active ? 'on' : 'off'}">${active ? '有効' : '停止中'}</span></div>
                <div class="school-code-sub">${escapeHtml(row.schoolName || '学校名なし')} ／ 参加者 ${count}人</div>
              </div>
              <div class="admin-code-actions">
                <button class="school-small-btn" onclick="toggleSchoolCodeActive('${escapeHtml(row.id)}', ${active ? 'false' : 'true'}).then(loadAdminDashboard)">${active ? '停止' : '有効化'}</button>
                <button class="school-small-btn danger" onclick="deleteSchoolCode('${escapeHtml(row.id)}')">削除</button>
              </div>
            </div>`;
          }).join('') : '<div class="school-muted admin-empty">まだ発行済みコードはありません。</div>'}
        </div>
      </section>
    `;
  } catch (e) {
    console.warn('loadAdminDashboard error:', e);
    wrap.innerHTML = '<div class="school-muted">管理者データを取得できませんでした。時間をおいて再度お試しください。</div>';
  }
}

function renderSchoolCodeSettings() {
  const code = getSchoolCode();
  const name = getSchoolName();
  const admin = isSchoolAdmin();
  return `
    <div class="account-card school-code-card">
      <div class="ranking-meta-title">学校別参加コード</div>
      <div class="school-status-box ${code ? 'joined' : ''}">
        <div class="school-status-icon">${code ? '🏫' : '🔑'}</div>
        <div>
          <div class="school-status-title">${code ? `${escapeHtml(name || '学校グループ')}に参加中` : '学校グループ未参加'}</div>
          <div class="school-status-sub">${code ? `参加コード：${escapeHtml(code)}` : '発行済みコードを入力すると、同じ学校内ランキングに切り替わります。'}</div>
        </div>
      </div>
      <div class="school-join-row">
        <input id="school-code-input" class="account-input" value="${escapeHtml(code)}" placeholder="例：ABC123" maxlength="20">
        <button class="btn btn-primary" onclick="joinSchoolCode()">参加</button>
        <button class="btn btn-secondary" onclick="clearSchoolCode()">解除</button>
      </div>
      <div class="account-help">ログインなしでも端末に保存されます。ログイン中はアカウントにも保存されます。</div>
    </div>
    <div class="account-card school-admin-card">
      <div class="admin-card-header"><div><div class="ranking-meta-title">管理者用コード発行</div><div class="admin-card-sub">学校・クラスごとの参加コードを作成できます。</div></div><span class="admin-card-mark">管理者</span></div>
      ${admin ? `
        <div class="school-admin-grid">
          <input id="admin-school-name-input" class="account-input" placeholder="学校名・クラス名 例：桜高校 2年A組" maxlength="40">
          <div class="school-admin-code-row">
            <input id="admin-school-code-input" class="account-input" placeholder="参加コード" maxlength="20">
            <button class="btn btn-secondary" onclick="fillSchoolCodeSuggestion()">自動生成</button>
          </div>
          <button class="btn btn-primary" onclick="issueSchoolCode()">コードを発行</button>
        </div>
        <div class="school-logo-admin">
          <div class="account-label">学校ロゴ</div>
          <p class="account-help">学校IDを入力してロゴを登録すると、その学校でログインした人のヘッダーに表示されます。横長・正方形の画像に対応します。</p>
          <input id="admin-school-logo-code" class="account-input" placeholder="ロゴを設定する学校ID" maxlength="20">
          <div class="school-logo-actions"><label class="avatar-picker">画像を選択<input type="file" accept="image/jpeg,image/png,image/webp" onchange="saveSchoolLogo(this)"></label><button type="button" class="btn btn-secondary" onclick="removeSchoolLogo()">ロゴを削除</button></div>
        </div>
        <div class="school-issued-head">発行済みコード</div>
        <div id="admin-school-code-list" class="school-code-list"></div>
        <div class="school-issued-head">クラス別・今回の単語テスト範囲</div>
        <div class="admin-class-range-form">
          <input id="admin-class-school" class="account-input" placeholder="発行済みの学校ID" maxlength="20">
          <input id="admin-class-id" class="account-input" placeholder="クラスID（学校共通なら空欄）" maxlength="20">
          <input id="admin-class-name" class="account-input" placeholder="クラス名 例：2年A組（任意）" maxlength="40">
          <input id="admin-class-start" class="account-input" type="number" min="1" max="2027" placeholder="開始番号">
          <input id="admin-class-end" class="account-input" type="number" min="1" max="2027" placeholder="終了番号">
          <button type="button" class="btn btn-primary" onclick="saveClassTestRange()">このクラスの範囲を保存</button>
        </div>
        <div class="admin-dashboard-card">
          
          <div id="admin-dashboard-body" class="admin-dashboard-body"></div>
        </div>
      ` : `
        <div class="school-muted">参加コードの発行は管理者のみ可能です。管理者にするには、assets/js/app.js の ADMIN_EMAILS または ADMIN_UIDS に対象アカウントを追加してください。</div>
      `}
    </div>
  `;
}

function hasAcceptedWelcome() {
  try { return localStorage.getItem(WELCOME_ACCEPTED_KEY) === '1'; } catch (e) { return false; }
}

function markWelcomeAccepted() {
  try { localStorage.setItem(WELCOME_ACCEPTED_KEY, '1'); } catch (e) {}
}

function showWelcomeModalIfNeeded() {
  if (hasAcceptedWelcome()) { startOnboardingIfNeeded(); return; }
  const modal = document.getElementById('welcome-modal');
  if (!modal) return;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}

function closeWelcomeModal() {
  const modal = document.getElementById('welcome-modal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
}

function acceptWelcomeAsGuest() {
  markWelcomeAccepted();
  closeWelcomeModal();
  startOnboardingIfNeeded();
}

function acceptWelcomeAndOpenLogin() {
  markWelcomeAccepted();
  closeWelcomeModal();
  startOnboardingIfNeeded();
}

const ONBOARDING_COMPLETE_KEY = 'systan_onboarding_completed_v1';
let onboardingStep = 0;
let onboardingAuthOpen = false;
const onboardingTutorial = [
  ['単語範囲を選ぶ', '学習タブで出題項目と単語番号を選び、「クイズ開始」を押します。'],
  ['答えて、次へ進む', '選択問題は答えをタップ。記述問題は入力して採点します。わからないときはカード内の「わからない」で飛ばせます。'],
  ['間違いを復習する', '間違えた単語は復習タブに集まります。間違いが10語以上になると、学習タブにも復習の案内が表示されます。']
];
function startOnboardingIfNeeded() {
  try { if (localStorage.getItem(ONBOARDING_COMPLETE_KEY) === '1') return; } catch (e) {}
  onboardingStep = 0;
  renderOnboarding();
}
function renderOnboarding() {
  const modal = document.getElementById('onboarding-modal');
  if (!modal) return;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  document.getElementById('onboarding-progress').innerHTML = Array.from({length:4}, (_, i) => `<span class="${i <= onboardingStep ? 'current' : ''}"></span>`).join('');
  const title = document.getElementById('onboarding-title');
  const description = document.getElementById('onboarding-description');
  const extra = document.getElementById('onboarding-extra');
  const actions = document.getElementById('onboarding-actions');
  const label = document.getElementById('onboarding-step-label');
  if (onboardingStep === 0) {
    label.textContent = 'STEP 1 / アカウント';
    title.textContent = '学習データを保存する';
    description.textContent = 'メールで新規登録、Google、学校IDで利用できます。登録は後からでも可能です。';
    extra.textContent = 'メールで登録する場合は、次の画面でメールアドレスとパスワードを入力し「新規登録」を押してください。';
    actions.innerHTML = '<button type="button" class="welcome-login-btn" onclick="openOnboardingAuth()">アカウントを作成・ログイン</button><button type="button" class="onboarding-skip" onclick="advanceOnboarding()">後で設定する</button>';
  } else {
    const index = onboardingStep - 1;
    label.textContent = `STEP ${onboardingStep + 1} / 使い方`;
    title.textContent = onboardingTutorial[index][0];
    description.textContent = onboardingTutorial[index][1];
    extra.textContent = `${index + 1} / ${onboardingTutorial.length}`;
    actions.innerHTML = `<button type="button" class="welcome-login-btn" onclick="advanceOnboarding()">${onboardingStep === 3 ? '学習を始める' : '次へ'}</button>`;
  }
}
function openOnboardingAuth() {
  onboardingAuthOpen = true;
  try { localStorage.setItem(ONBOARDING_COMPLETE_KEY, '1'); } catch (e) {}
  const modal = document.getElementById('onboarding-modal');
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  showAuthModal();
}
function advanceOnboarding() {
  if (onboardingStep < 3) { onboardingStep++; renderOnboarding(); return; }
  try { localStorage.setItem(ONBOARDING_COMPLETE_KEY, '1'); } catch (e) {}
  const modal = document.getElementById('onboarding-modal');
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  showHome();
  window.scrollTo({top:0,behavior:'instant'});
}

async function acceptWelcomeAndLogin() {
  acceptWelcomeAndOpenLogin();
}

function renderAuthFab() {
  const user = auth.currentUser;
  profileAvatarData = user ? getStoredProfileAvatar(user.uid) : getStoredProfileAvatar('guest');
  const displayName = user ? getPublicNickname(user) : 'ログイン';
  const headerButton = document.getElementById('header-account-button');
  if (headerButton) {
    headerButton.innerHTML = profileAvatarData
      ? `<img class="header-account-avatar" src="${profileAvatarData}" alt="">`
      : user
        ? `<span class="header-account-avatar-fallback">${escapeHtml(getInitials(displayName))}</span>`
        : '<span class="header-account-avatar-fallback"><svg class="header-login-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg></span>';
    headerButton.setAttribute('aria-label', user ? `${displayName}さんのマイページ` : 'ログイン');
  }
  const el = document.getElementById('auth-fab');
  if (!el) return;
  if (!user) {
    el.innerHTML = `
      <button class="auth-pill auth-pill-login" onclick="login()" title="ログイン">
        <span class="auth-dot-avatar">↗</span>
        <span class="auth-pill-text">
          <span class="auth-pill-name">ログイン</span>
          <span class="auth-pill-sub">Google / メール</span>
        </span>
      </button>
    `;
    return;
  }
  const nick = getPublicNickname(user);
  el.innerHTML = `
    <button class="auth-pill" onclick="showAccountSettings()" title="アカウント設定">
      <span class="auth-dot-avatar">${escapeHtml(getInitials(nick))}</span>
      <span class="auth-pill-text">
        <span class="auth-pill-name">${escapeHtml(nick)}</span>
        <span class="auth-pill-sub">アカウント設定</span>
      </span>
    </button>
  `;
}


async function saveCloudProgress() {
  if (!auth.currentUser) return;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    await db.collection('users').doc(auth.currentUser.uid).set({
      appState: raw,
      appStateUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      profileNickname: getPublicNickname(auth.currentUser)
    }, { merge: true });
  } catch (e) {
    console.warn('saveCloudProgress error:', e);
  }
}

function queueCloudProgressSave() {
  if (!auth.currentUser) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => {
    saveCloudProgress();
  }, 500);
}

async function restoreCloudProgress() {
  if (!auth.currentUser) return false;
  try {
    const snap = await db.collection('users').doc(auth.currentUser.uid).get();
    if (!snap.exists) return false;
    const data = snap.data() || {};
    if (!data.appState) return false;
    const localRaw = localStorage.getItem(STORAGE_KEY);
    const localSavedAt = (() => { try { return JSON.parse(localRaw || '{}').savedAt || ''; } catch(e) { return ''; } })();
    const remoteSavedAt = (() => { try { return JSON.parse(data.appState || '{}').savedAt || ''; } catch(e) { return ''; } })();
    if (remoteSavedAt && (!localSavedAt || new Date(remoteSavedAt).getTime() > new Date(localSavedAt).getTime())) {
      localStorage.setItem(STORAGE_KEY, data.appState);
      loadProgress();
      showSyncStatus('クラウドの学習記録を読み込みました');
      return true;
    }
    return false;
  } catch (e) {
    console.warn('restoreCloudProgress error:', e);
    return false;
  }
}

function getLeaderboardPayload() {
  const stats = getTotalStats();
  const mastered = stats['◎'] || 0;
  const done = (stats['○'] || 0) + (stats['◎'] || 0) + (stats['×'] || 0);
  const accuracy = leaderboardStats.totalAnswered > 0
    ? Math.round((leaderboardStats.totalCorrect / leaderboardStats.totalAnswered) * 1000) / 10
    : 0;

  return {
    uid: auth.currentUser ? auth.currentUser.uid : null,
    nickname: getPublicNickname(auth.currentUser),
    name: getPublicNickname(auth.currentUser),
    photoURL: '',
    mastered,
    done,
    totalAnswered: leaderboardStats.totalAnswered || 0,
    totalCorrect: leaderboardStats.totalCorrect || 0,
    totalWrong: leaderboardStats.totalWrong || 0,
    accuracy,
    schoolCode: getSchoolCode() || null,
    schoolName: getSchoolName() || null,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
}

function getPublicRankingName(row) {
  const nick = String((row && (row.nickname || row.publicName)) || '').trim();
  if (nick) return nick;
  return getAnonymousName(row && (row.uid || row.id));
}

async function loadAccountProfile() {
  if (!auth.currentUser) {
    accountProfile = { nickname: '' };
    return accountProfile;
  }
  try {
    const snap = await db.collection('users').doc(auth.currentUser.uid).get();
    const data = snap.exists ? (snap.data() || {}) : {};
    const remoteNickname = String(data.profileNickname || data.nickname || '').trim();
    accountProfile = { nickname: remoteNickname };
    profileAvatarData = getStoredProfileAvatar(auth.currentUser.uid);
    if (remoteNickname && !getStoredNickname()) setStoredNickname(remoteNickname);
    if (data.schoolCode) setLocalSchoolCode(data.schoolCode, data.schoolName || '');
  } catch (e) {
    console.warn('loadAccountProfile error:', e);
  }
  return accountProfile;
}

function getStoredProfileAvatar(uid = auth.currentUser?.uid || 'guest') {
  try {
    const value = localStorage.getItem(PROFILE_AVATAR_KEY_PREFIX + uid) || '';
    return /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value) ? value : '';
  } catch (e) { return ''; }
}

async function changeProfileAvatar(input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (!auth.currentUser) {
    showSyncStatus('画像を設定するにはログインしてください', true);
    input.value = '';
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    showSyncStatus('JPEG・PNG・WebP形式の5MB以下の画像を選んでください', true);
    input.value = '';
    return;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const compressed = canvas.toDataURL('image/webp', 0.78);
    if (compressed.length > 280000) throw new Error('image_too_large');
    localStorage.setItem(PROFILE_AVATAR_KEY_PREFIX + auth.currentUser.uid, compressed);
    profileAvatarData = compressed;
    renderAuthFab();
    renderAccountSettings();
    showSyncStatus('プロフィール画像をこの端末に保存しました');
  } catch (e) {
    console.warn('Profile image could not be prepared:', e);
    showSyncStatus('画像を読み込めませんでした。別の画像を選んでください', true);
  } finally {
    input.value = '';
  }
}

function renderProfileAvatar(name, className = 'account-avatar-large') {
  return profileAvatarData
    ? `<img class="${className} profile-avatar-image" src="${profileAvatarData}" alt="プロフィール画像">`
    : `<div class="${className}">${escapeHtml(getInitials(name))}</div>`;
}

async function saveAccountNickname() {
  if (!auth.currentUser) {
    showSyncStatus('ログイン後に設定できます', true);
    return;
  }
  const input = document.getElementById('account-nickname-input');
  const raw = input ? input.value.trim() : '';
  const nickname = raw.slice(0, 16);
  if (!nickname) {
    showSyncStatus('ニックネームを入力してください', true);
    return;
  }
  try {
    setStoredNickname(nickname);
    accountProfile.nickname = nickname;
    await db.collection('users').doc(auth.currentUser.uid).set({
      profileNickname: nickname,
      nicknameUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await syncLeaderboardProfile();
    await fetchLeaderboard();
    renderAuthFab();
    renderAccountSettings();
    renderHomeRankingPanel();
    if (document.getElementById('screen-ranking') && document.getElementById('screen-ranking').classList.contains('active')) {
      renderRanking();
    }
    showSyncStatus('ニックネームを保存しました');
  } catch (e) {
    console.warn('saveAccountNickname error:', e);
    showSyncStatus('保存に失敗しました', true);
  }
}

async function syncLeaderboardProfile() {
  if (!auth.currentUser) return;
  try {
    await db.collection('rankings').doc(auth.currentUser.uid).set(getLeaderboardPayload(), { merge: true });
  } catch (e) {
    console.warn('syncLeaderboardProfile error:', e);
  }
}

async function fetchLeaderboard() {
  if (!auth.currentUser) {
    leaderboardCache = [];
    myLeaderboardRank = null;
    return [];
  }
  try {
    const activeSchoolCode = getSchoolCode() || null;
    const snap = await db.collection('rankings').where('schoolCode', '==', activeSchoolCode).limit(100).get();
    leaderboardCache = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (activeSchoolCode) {
      leaderboardCache = leaderboardCache.filter(row => normalizeSchoolCode(row.schoolCode) === activeSchoolCode);
    }
    leaderboardCache.sort((a, b) =>
      (Number(b.mastered || 0) - Number(a.mastered || 0)) ||
      (Number(b.totalCorrect || 0) - Number(a.totalCorrect || 0)) ||
      (Number(b.accuracy || 0) - Number(a.accuracy || 0))
    );
    const uid = auth.currentUser && auth.currentUser.uid;
    myLeaderboardRank = uid ? leaderboardCache.findIndex(item => item.id === uid) + 1 || null : null;
    return leaderboardCache;
  } catch (e) {
    console.warn('fetchLeaderboard error:', e);
    leaderboardCache = [];
    myLeaderboardRank = null;
    showSyncStatus('ランキングの取得に失敗しました', true);
    return [];
  }
}


function renderHomeRankingPanel() {
  const el = document.getElementById('home-ranking-panel');
  if (!el) return;
  const stats = getTotalStats();
  const mastered = stats['◎'] || 0;
  const answered = leaderboardStats.totalAnswered || 0;
  const accuracy = answered > 0 ? Math.round((leaderboardStats.totalCorrect / answered) * 1000) / 10 : 0;
  const rankLabel = auth.currentUser
    ? (myLeaderboardRank ? `#${myLeaderboardRank}` : '—')
    : 'Login';
  const sub = auth.currentUser
    ? `習得 ${mastered}語 ・ 正答率 ${accuracy}% ・ タップでランキングを見る`
    : 'ログインすると、あなたの成績を全体ランキングに反映できます';

  el.innerHTML = `
    <div class="ranking-panel" onclick="showRanking()">
      <div class="ranking-panel-icon">🏆</div>
      <div class="ranking-panel-info">
        <div class="ranking-panel-title">${getSchoolCode() ? '学校別ランキング' : 'ランキング'}</div>
        <div class="ranking-panel-sub">${getSchoolCode() ? `${escapeHtml(getSchoolName() || getSchoolCode())}内の順位 ／ ` : ''}${sub}</div>
      </div>
      <div class="ranking-panel-rank">
        <div class="ranking-panel-rank-num">${rankLabel}</div>
        <div class="ranking-panel-rank-label">${auth.currentUser ? 'あなたの順位' : 'ログイン推奨'}</div>
      </div>
    </div>
  `;
}

async function renderRanking() {
  const listEl = document.getElementById('ranking-list');
  const myEl = document.getElementById('ranking-my-summary');
  if (!listEl || !myEl) return;

  if (!auth.currentUser) {
    listEl.innerHTML = `<div class="ranking-locked"><div class="ranking-locked-icon">🔒</div><div class="ranking-locked-title">ランキングはログイン中のみ閲覧できます</div><div class="ranking-locked-sub">プライバシー保護のため、ランキングの閲覧と参加にはログインが必要です。表示名はGoogleアカウント名ではなく、ニックネームのみ使用します。</div><button class="btn btn-primary" onclick="login()">Googleでログイン</button></div>`;
    myEl.innerHTML = '<div class="ranking-note">ログイン後、アカウント設定でニックネームを変更できます。本名・メールアドレス・Googleプロフィール写真はランキングに表示しません。</div>';
    renderHomeRankingPanel();
    return;
  }

  await syncLeaderboardProfile();
  const rows = await fetchLeaderboard();
  if (!rows.length) {
    listEl.innerHTML = '<div class="ranking-empty">まだランキングデータがありません。最初の1人目になれます。</div>';
  } else {
    listEl.innerHTML = rows.slice(0, 20).map((row, idx) => {
      const me = row.id === auth.currentUser.uid;
      return `
        <div class="ranking-item ${idx === 0 ? 'top1' : idx === 1 ? 'top2' : idx === 2 ? 'top3' : ''} ${me ? 'me' : ''}">
          <div class="ranking-rank-badge">${idx + 1}</div>
          <div class="ranking-user">
            <div class="ranking-name">${escapeHtml(getPublicRankingName(row))} ${me ? '<span class="ranking-you-tag">YOU</span>' : ''}</div>
            <div class="ranking-sub">習得 ${row.mastered || 0}語 ／ 正解 ${row.totalCorrect || 0}回 ／ 正答率 ${Number(row.accuracy || 0).toFixed(1)}%</div>
          </div>
          <div class="ranking-score">
            <div class="ranking-score-main">${row.mastered || 0}</div>
            <div class="ranking-score-label">◎ mastered</div>
          </div>
        </div>
      `;
    }).join('');
  }

  const answered = leaderboardStats.totalAnswered || 0;
  const accuracy = answered > 0 ? Math.round((leaderboardStats.totalCorrect / answered) * 1000) / 10 : 0;
  myEl.innerHTML = `
    <div class="ranking-stat-grid">
      <div class="ranking-stat-box">
        <div class="ranking-stat-value">${myLeaderboardRank ? '#' + myLeaderboardRank : '—'}</div>
        <div class="ranking-stat-label">現在順位</div>
      </div>
      <div class="ranking-stat-box">
        <div class="ranking-stat-value">${getTotalStats()['◎'] || 0}</div>
        <div class="ranking-stat-label">習得語数 ◎</div>
      </div>
      <div class="ranking-stat-box">
        <div class="ranking-stat-value">${leaderboardStats.totalCorrect || 0}</div>
        <div class="ranking-stat-label">累計正解数</div>
      </div>
      <div class="ranking-stat-box">
        <div class="ranking-stat-value">${accuracy}%</div>
        <div class="ranking-stat-label">正答率</div>
      </div>
    </div>
  `;
  renderHomeRankingPanel();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function renderRoleAccessSettingsCard(user) {
  if (!user) return '';
  const isAdmin = isSchoolAdmin(user);
  const isTeacher = String(accountProfile.role || '').trim() === 'teacher';
  if (!isAdmin && !isTeacher) return '';
  return `
    <div class="account-card role-access-settings-card">
      <div class="ranking-meta-title">権限メニュー</div>
      <div class="account-help">先生・管理者向けページはこちらから開けます。アクセス権限がないページは表示されません。</div>
      <div class="role-access-actions-row">
        ${isTeacher || isAdmin ? '<button class="btn btn-secondary role-access-action teacher" onclick="location.href=&quot;./teacher.html&quot;"><span>🏫</span><strong>先生用ページ</strong></button>' : ''}
        ${isAdmin ? '<button class="btn btn-secondary role-access-action admin" onclick="location.href=&quot;./admin.html&quot;"><span>🛠</span><strong>管理者ページ</strong></button>' : ''}
      </div>
    </div>
  `;
}

let accountSettingsTab = 'profile';

function setAccountSettingsTab(tab) {
  if (!['profile', 'study', 'school'].includes(tab)) return;
  accountSettingsTab = tab;
  renderAccountSettings();
}

function renderAccountSettings() {
  const el = document.getElementById('account-settings-body');
  if (!el) return;
  const user = auth.currentUser;
  const signedInUser = !!user;
  const nickname = !user ? '' : user.isAnonymous
    ? (getSchoolName() ? `${getSchoolName()}の学習者` : '学習者')
    : getPublicNickname(user);
  const tabs = [
    ['profile', 'プロフィール設定'],
    ['study', '単語学習設定'],
    ['school', '学校・アカウント']
  ];
  const tabNav = `<nav class="account-settings-tabs" aria-label="マイページ設定">${tabs.map(([id, label]) => `<button type="button" class="account-tab-button${accountSettingsTab === id ? ' active' : ''}" aria-pressed="${accountSettingsTab === id}" onclick="setAccountSettingsTab('${id}')">${label}</button>`).join('')}</nav>`;

  let panel = '';
  if (accountSettingsTab === 'profile') {
    if (!signedInUser) {
      panel = `
        <section class="account-card account-login-prompt">
          <div class="account-login-mark" aria-hidden="true">👤</div>
          <h2>ログインしよう</h2>
          <p>ログインすると、学習記録の同期やランキング、プロフィール設定が使えます。</p>
          <button class="btn btn-primary" type="button" onclick="login()">ログイン・新規登録へ</button>
          <button class="btn btn-secondary" type="button" onclick="showHome()">学習に戻る</button>
        </section>`;
    } else {
      const stats = getTotalStats();
      const answered = leaderboardStats.totalAnswered || 0;
      const accuracy = answered > 0 ? Math.round((leaderboardStats.totalCorrect / answered) * 1000) / 10 : 0;
      panel = `
        <section class="account-card account-profile-card">
          <div class="account-hero">${renderProfileAvatar(nickname)}<div><h2 class="account-title-main">プロフィール設定</h2><p class="account-sub-main">表示名とプロフィール画像を管理できます。</p></div></div>
          <div class="account-field"><label class="account-label" for="account-nickname-input">表示名</label><input id="account-nickname-input" class="account-input" maxlength="16" value="${escapeHtml(nickname)}" placeholder="ランキングに表示する名前"><div class="account-help">最大16文字。ランキングに表示されます。</div></div>
          <div class="account-field"><div class="account-label">プロフィール画像</div><label class="avatar-picker">写真を選ぶ<input type="file" accept="image/jpeg,image/png,image/webp" onchange="changeProfileAvatar(this)"></label><div class="account-help">画像はこの端末内に保存され、ランキングには表示されません。</div></div>
          <div class="account-actions"><button class="btn btn-primary" onclick="saveAccountNickname()">プロフィールを保存</button><button class="btn btn-secondary" onclick="logout()">ログアウト</button></div>
        </section>
        <section class="account-card"><div class="ranking-meta-title">学習の状況</div><div class="account-mini-stat">
          <div class="account-mini-box"><div class="account-mini-value">${stats['◎'] || 0}</div><div class="account-mini-label">習得語数</div></div>
          <div class="account-mini-box"><div class="account-mini-value">${myLeaderboardRank ? '#' + myLeaderboardRank : '—'}</div><div class="account-mini-label">順位</div></div>
          <div class="account-mini-box"><div class="account-mini-value">${leaderboardStats.totalCorrect || 0}</div><div class="account-mini-label">正解数</div></div>
          <div class="account-mini-box"><div class="account-mini-value">${accuracy}%</div><div class="account-mini-label">正答率</div></div>
        </div></section>`;
    }
  } else if (accountSettingsTab === 'study') {
    panel = `<section class="account-card"><h2 class="account-panel-title">単語学習設定</h2><p class="account-help">問題の読み上げなど、学習時の設定を変更できます。</p>${renderVoiceSettingsCard()}</section>`;
  } else {
    panel = `<section class="account-card"><h2 class="account-panel-title">学校との紐づけ</h2><p class="account-help">学校IDを登録すると、学校別ランキングやクラスの出題範囲が使えます。ログイン中は所属をアカウントに保存します。</p>${renderSchoolCodeSettings()}${signedInUser ? renderRoleAccessSettingsCard(user) : '<button class="btn btn-primary" type="button" onclick="login()">学校をアカウントに登録するにはログイン</button>'}</section>`;
  }

  el.innerHTML = `<div class="account-greeting"><span class="account-greeting-kicker">MY PAGE</span><h1>${signedInUser ? `こんにちは、${escapeHtml(nickname)}さん` : 'ログインしよう'}</h1><p>${signedInUser ? '学習の設定やプロフィールをここで管理できます。' : 'ログインすると、学習記録を保存して続きから学べます。'}</p></div>${tabNav}<div class="account-tab-panel" role="region" aria-live="polite">${panel}</div>`;
  if (signedInUser && accountSettingsTab === 'school') setTimeout(() => { loadIssuedSchoolCodes(); loadAdminDashboard(); }, 0);
}
function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.progress) {
        Object.keys(saved.progress).forEach(id => {
          const val = saved.progress[id];
          if (typeof val === 'string') {
            progress[id] = { q1: val || null, q2: null, q3: null };
          } else if (val && typeof val === 'object') {
            progress[id] = {
              q1: val.q1 || null,
              q2: val.q2 || null,
              q3: val.q3 || null,
              latestStatus: ['◎', '○', '×'].includes(val.latestStatus) ? val.latestStatus : null,
              latestAnsweredAt: Number(val.latestAnsweredAt) || null
            };
          }
        });
      }
      if (saved.quizProgress) {
        Object.keys(saved.quizProgress).forEach(id => {
          const qp = saved.quizProgress[id];
          if (!progress[id]) progress[id] = { q1: null, q2: null, q3: null };
          if (qp.q1) progress[id].q1 = qp.q1;
          if (qp.q2) progress[id].q2 = qp.q2;
          if (qp.q3) progress[id].q3 = qp.q3;
        });
      }
      if (saved.bookmarks && Array.isArray(saved.bookmarks)) {
        bookmarks = new Set(saved.bookmarks);
      }
      if (Number.isInteger(saved.normalQuizCount) && saved.normalQuizCount > 0) {
        normalQuizCount = saved.normalQuizCount;
      }
      if (Number.isInteger(saved.bookmarkQuizCount) && saved.bookmarkQuizCount > 0) {
        bookmarkQuizCount = saved.bookmarkQuizCount;
      }
      if (saved.setQuizRanges && typeof saved.setQuizRanges === 'object') {
        setQuizRanges = saved.setQuizRanges;
      }
      if (saved.leaderboardStats && typeof saved.leaderboardStats === 'object') {
        leaderboardStats = {
          totalAnswered: Number(saved.leaderboardStats.totalAnswered) || 0,
          totalCorrect: Number(saved.leaderboardStats.totalCorrect) || 0,
          totalWrong: Number(saved.leaderboardStats.totalWrong) || 0,
          updatedAt: saved.leaderboardStats.updatedAt || null
        };
      }
      if (saved.schoolCode) setLocalSchoolCode(saved.schoolCode, saved.schoolName || '');
      if (saved.savedAt) {
        window.__lastSavedAt = saved.savedAt;
      }
    }
  } catch(e) {
    console.warn('loadProgress error:', e);
    progress = {};
    bookmarks = new Set();
  }
}

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      progress,
      bookmarks: Array.from(bookmarks),
      normalQuizCount,
      bookmarkQuizCount,
      setQuizRanges,
      leaderboardStats,
      schoolCode: getSchoolCode(),
      schoolName: getSchoolName(),
      savedAt: new Date().toISOString()
    }));
    queueCloudProgressSave();
  } catch(e) {
    console.warn('saveProgress error:', e);
  }
}

// =========================================================
// NAVIGATION
// =========================================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById(id).classList.add('active');
  const studying = id === 'screen-quiz';
  document.body.classList.toggle('is-quiz-active', studying);
  document.body.classList.toggle('is-studying', studying);
  document.getElementById('mobile-bottom-nav')?.classList.toggle('hidden', studying);
}

function scrollQuizToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  });
}

function relocateDashboardPanels() {
  const targets = [
    ['home-word-search-panel', 'search-panel-slot'],
    ['home-stats', 'results-stats-slot'],
    ['home-ranking-panel', 'results-ranking-panel-slot']
  ];
  targets.forEach(([source, destination]) => {
    const node = document.getElementById(source);
    const slot = document.getElementById(destination);
    if (node && slot && node.parentElement !== slot) slot.appendChild(node);
  });
}

function showSearch() { showBookmarks(); document.getElementById('home-word-search-input')?.focus(); }

function showProgress() {
  showResultsDashboard();
}

async function showResultsDashboard() {
  relocateDashboardPanels();
  const rankingContent = document.querySelector('#screen-ranking > .content');
  const slot = document.getElementById('results-leaderboard-slot');
  if (rankingContent && slot) slot.appendChild(rankingContent);
  renderHome();
  showScreen('screen-results-dashboard');
  await renderRanking();
}

function showAccountTab() {
  showAccountSettings();
}

function showSearchWord(id) {
  if (!WORD_MAP[id]) return;
  setQuizRanges[0] = { startId: id, endId: id };
  showHome();
  document.getElementById('sets-grid')?.scrollIntoView({ behavior:'smooth', block:'start' });
}

function showHome() {
  relocateDashboardPanels();
  renderHome();
  renderPwaInvite();
  const grid = document.getElementById('sets-grid');
  const picker = document.querySelector('#screen-set > .content');
  if (picker && grid) grid.replaceChildren(picker);
  currentSetIdx = 0;
  renderSet();
  showScreen('screen-home');
}

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  renderPwaInvite();
});
window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; renderPwaInvite(); });
function renderPwaInvite() {
  const container = document.getElementById('home-pwa-invite');
  if (!container) return;
  if (isInstalledPwa() || localStorage.getItem('systan-pwa-invite-dismissed')) { container.replaceChildren(); return; }
  const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const note = isApple ? '共有ボタンから「ホーム画面に追加」を選択できます。' : 'ホーム画面に追加すると、すぐに学習を再開できます。';
  container.innerHTML = `<div class="pwa-invite"><div><strong>アプリとして使う</strong><p>${note}</p></div><div class="pwa-invite-actions"><button type="button" class="btn btn-primary" id="pwa-install-action">${deferredInstallPrompt ? 'インストール' : '追加方法を見る'}</button><button type="button" class="btn btn-secondary" id="pwa-dismiss-action" aria-label="案内を閉じる">閉じる</button></div></div>`;
  container.querySelector('#pwa-install-action').onclick = async () => {
    if (deferredInstallPrompt) {
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      await promptEvent.prompt();
      await promptEvent.userChoice;
      renderPwaInvite();
    } else alert(isApple ? 'Safari の共有ボタンから「ホーム画面に追加」を選択してください。' : 'ブラウザのメニューから「アプリをインストール」または「ホーム画面に追加」を選択してください。');
  };
  container.querySelector('#pwa-dismiss-action').onclick = () => { localStorage.setItem('systan-pwa-invite-dismissed', '1'); renderPwaInvite(); };
}

function showSet(setIdx) {
  showHome();
  document.getElementById('sets-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openSharedSelection() {
  const params = new URLSearchParams(location.search);
  if (params.get('view') !== 'words') return false;
  const validId = value => /^\d{1,5}$/.test(value || '') && Number(value) >= WORDS[0].id && Number(value) <= WORDS[WORDS.length - 1].id;
  if (!validId(params.get('start')) || !validId(params.get('end')) || Number(params.get('start')) > Number(params.get('end'))) {
    showHome();
    showRangeError(`共有URLの単語範囲が正しくありません。${WORDS[0].id}〜${WORDS[WORDS.length - 1].id}の番号を指定してください。`);
    return true;
  }
  currentSetIdx = 0;
  setQuizRanges[0] = { startId: Number(params.get('start')), endId: Number(params.get('end')) };
  const mode = Number(params.get('mode'));
  if ([1, 2, 3].includes(mode)) selectedMode = mode;
  if (['all', 'mix', 'circle', 'cross', 'bookmark'].includes(params.get('retest'))) selectedRetest = params.get('retest');
  showHome();
  return true;
}

async function shareWordSelection() {
  if (!commitSetRangeInput()) return;
  const range = ensureSetRange(currentSetIdx);
  const url = new URL(location.href);
  url.searchParams.set('view', 'words');
  url.searchParams.set('start', range.startId);
  url.searchParams.set('end', range.endId);
  url.searchParams.set('mode', selectedMode);
  url.searchParams.set('retest', selectedRetest);
  try {
    if (navigator.share) await navigator.share({ title: 'シス単マスター：単語選択', url: url.href });
    else if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(url.href); alert('共有URLをコピーしました'); }
    else prompt('共有URLをコピーしてください', url.href);
  } catch (error) { if (error.name !== 'AbortError') prompt('共有URLをコピーしてください', url.href); }
}

function showBookmarks() {
  renderBookmarks();
  showScreen('screen-bookmark');
}

async function showRanking() {
  await showResultsDashboard();
}

function chooseMobileMode(mode) { selectMode(mode); syncMobileStudyChoices(); }
function chooseMobileRetest(target) { selectRetest(target); syncMobileStudyChoices(); }
function syncMobileStudyChoices() {
  document.querySelectorAll('.mobile-study-choices [data-mode]').forEach(button => {
    const active = Number(button.dataset.mode) === selectedMode;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.mobile-study-choices [data-retest]').forEach(button => {
    const active = button.dataset.retest === selectedRetest;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

async function showAccountSettings() {
  if (auth.currentUser) await loadAccountProfile();
  renderAccountSettings();
  showScreen('screen-account');
}

function selectMode(m) {
  selectedMode = m;
  const select = document.getElementById('mode-select');
  if (select && Number(select.value) !== m) select.value = String(m);
  [1,2,3].forEach(i => {
    const btn = document.getElementById('mode-btn-'+i);
    if (btn) btn.classList.toggle('active', i === m);
  });
  renderSet();
}

function selectBmMode(m) {
  selectedBmMode = m;
  const select = document.getElementById('bm-mode-select');
  if (select && Number(select.value) !== m) select.value = String(m);
  [1,2,3].forEach(i => {
    const btn = document.getElementById('bm-mode-btn-'+i);
    if (btn) btn.classList.toggle('active', i === m);
  });
}

function quitQuiz() {
  if (confirm('クイズを中断しますか？進捗は保存されます。')) {
    if (quiz && quiz.type === 'bookmark') {
      showBookmarks();
    } else {
      showSet(currentSetIdx);
    }
  }
}

// =========================================================
// QUIZ GENERATION
// =========================================================
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function commonPrefixLen(a, b) {
  let n = 0;
  const len = Math.min(a.length, b.length);
  while (n < len && a[n] === b[n]) n++;
  return n;
}

function commonSuffixLen(a, b) {
  let n = 0;
  const len = Math.min(a.length, b.length);
  while (n < len && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function normalizedEnglishForChoice(text) {
  return String(text || '').toLowerCase().replace(/[^a-z]/g, '');
}

function japaneseOverlapScore(a, b) {
  const ignore = new Set(['～','を','に','の','る','す','、','。','；','・','A','B','と','て','で','が','は',' ']);
  const setA = new Set(String(a || '').split('').filter(ch => !ignore.has(ch)));
  const setB = new Set(String(b || '').split('').filter(ch => !ignore.has(ch)));
  let score = 0;
  setA.forEach(ch => { if (setB.has(ch)) score++; });
  return score;
}

function scoreDistractor(target, cand, mode) {
  const a = normalizedEnglishForChoice(target.en);
  const b = normalizedEnglishForChoice(cand.en);
  const idDiff = Math.abs(target.id - cand.id);
  const dist = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length, 1);

  let score = 0;
  score += Math.max(0, 70 - idDiff) * 1.8;
  score += Math.max(0, 20 - Math.abs(a.length - b.length)) * 2;
  score += Math.max(0, (1 - dist / maxLen)) * 45;
  score += commonPrefixLen(a, b) * 12;
  score += commonSuffixLen(a, b) * 7;
  if (a[0] && a[0] === b[0]) score += 16;
  if (a.slice(-1) && a.slice(-1) === b.slice(-1)) score += 8;
  if (mode === 1) score += japaneseOverlapScore(target.jp, cand.jp) * 7;
  score += Math.random() * 8;
  return score;
}

function getSmartDistractors(word, mode, count = 5) {
  const candidates = WORDS.filter(w => {
    if (w.id === word.id) return false;
    if (mode === 1 && w.jp === word.jp) return false;
    if (mode === 2 && w.en === word.en) return false;
    return true;
  });
  const scored = candidates
    .map(w => ({ word: w, score: scoreDistractor(word, w, mode) }))
    .sort((a, b) => b.score - a.score);
  const topPool = scored.slice(0, Math.min(24, scored.length)).map(x => x.word);
  return shuffle(topPool).slice(0, count);
}

function buildMode1Choices(word) {
  const correctJp = word.jp;
  const distractors = getSmartDistractors(word, 1, 5);
  const choices = shuffle([
    { text: correctJp, correct: true },
    ...distractors.map(d => ({ text: d.jp, correct: false, sourceId: d.id }))
  ]);
  return choices;
}

function buildMode2SingleChoices(word) {
  const correctEn = word.en;
  const distractors = getSmartDistractors(word, 2, 5);
  return shuffle([
    { text: correctEn, id: word.id, correct: true },
    ...distractors.map(d => ({ text: d.en, id: d.id, correct: false }))
  ]);
}

// =========================================================
// QUIZ FLOW
// =========================================================

function sanitizeQuizCount(value, maxCount) {
  if (maxCount <= 0) return 0;
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.min(10, maxCount);
  return Math.max(1, Math.min(maxCount, Math.floor(num)));
}

function syncQuizCountUI(type, availableCount) {
  const isBookmark = type === 'bookmark';
  const input = document.getElementById(isBookmark ? 'bm-quiz-count-input' : 'quiz-count-input');
  const help = document.getElementById(isBookmark ? 'bm-quiz-count-help' : 'quiz-count-help');
  if (!input || !help) return 0;

  const currentValue = isBookmark ? bookmarkQuizCount : normalQuizCount;
  const safeCount = sanitizeQuizCount(currentValue, availableCount);

  input.min = availableCount > 0 ? '1' : '0';
  input.max = String(Math.max(availableCount, 0));
  input.disabled = availableCount === 0;
  input.value = availableCount > 0 ? safeCount : 0;

  if (isBookmark) bookmarkQuizCount = safeCount || bookmarkQuizCount;
  else normalQuizCount = safeCount || normalQuizCount;

  help.textContent = availableCount > 0
    ? `1〜${availableCount}問まで指定できます`
    : '出題できる単語がありません';

  return safeCount;
}

function handleQuizCountInput(type) {
  const isBookmark = type === 'bookmark';
  const input = document.getElementById(isBookmark ? 'bm-quiz-count-input' : 'quiz-count-input');
  const availableCount = isBookmark ? getBmFilteredWords().length : getActiveWords(currentSetIdx).length;
  if (!input) return;

  if (availableCount === 0) {
    input.value = 0;
    return;
  }

  const safeCount = sanitizeQuizCount(input.value, availableCount);
  input.value = safeCount;
  if (isBookmark) bookmarkQuizCount = safeCount;
  else normalQuizCount = safeCount;
  saveProgress();
  syncQuizCountUI(type, availableCount);
}

function isSameRange(aStart, aEnd, bStart, bEnd) {
  return Number(aStart) === Number(bStart) && Number(aEnd) === Number(bEnd);
}

function showRangeError(message) {
  const error = document.getElementById('quiz-range-error');
  if (error) { error.textContent = message; error.hidden = !message; }
  for (const id of ['quiz-range-start-input', 'quiz-range-end-input']) {
    const input = document.getElementById(id);
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }
}

function applySetRange(startId, endId) {
  const min = WORDS[0].id, max = WORDS[WORDS.length - 1].id;
  const valid = value => /^\d+$/.test(String(value)) && Number(value) >= min && Number(value) <= max;
  if (!valid(startId) || !valid(endId) || Number(startId) > Number(endId)) {
    showRangeError(`開始・終了に${min}〜${max}の番号を入力し、開始番号を終了番号以下にしてください。`);
    return false;
  }
  showRangeError('');
  setQuizRanges[currentSetIdx] = { startId: Number(startId), endId: Number(endId) };
  saveProgress();
  renderSet();
  return true;
}

function commitSetRangeInput() {
  const start = document.getElementById('quiz-range-start-input');
  const end = document.getElementById('quiz-range-end-input');
  if (!start || !end) return false;
  return applySetRange(start.value, end.value);
}

function renderSetRangePresets() {
  const container = document.getElementById('quiz-range-presets');
  if (!container) return;

  const safe = ensureSetRange(currentSetIdx);
  const allMinId = WORDS[0].id;
  const allMaxId = WORDS[WORDS.length - 1].id;
  const presets = [{ label: '全単語', startId: allMinId, endId: allMaxId }];
  for (let start = allMinId; start <= allMaxId; start += 100) {
    presets.push({ label: `${start}〜${Math.min(start + 99, allMaxId)}`, startId: start, endId: Math.min(start + 99, allMaxId) });
  }

  container.innerHTML = presets.map(p => `
    <button
      type="button"
      class="range-preset-btn${isSameRange(safe.startId, safe.endId, p.startId, p.endId) ? ' active' : ''}"
      onclick="applySetRange(${p.startId}, ${p.endId})"
    >${p.label}</button>
  `).join('');
}

function updateSetRangeUI() {
  const startInput = document.getElementById('quiz-range-start-input');
  const endInput = document.getElementById('quiz-range-end-input');
  const help = document.getElementById('quiz-range-help');
  const summary = document.getElementById('quiz-range-summary');
  if (!startInput || !endInput || !help || !summary) return;

  const safe = ensureSetRange(currentSetIdx);
  startInput.min = String(safe.minId);
  startInput.max = String(safe.maxId);
  endInput.min = String(safe.minId);
  endInput.max = String(safe.maxId);
  startInput.value = safe.startId;
  endInput.value = safe.endId;

  const count = safe.endId - safe.startId + 1;
  summary.textContent = `${safe.startId}〜${safe.endId}番`;
  help.textContent = `${count}語を出題範囲に設定中です（全単語から選択できます）`;
  renderSetRangePresets();
}

function handleSetRangeInput() {
  // Keep the user's draft untouched while typing. Apply only on the button or action.
  showRangeError('');
}

function incrementSetRangeBound(bound, delta) {
  const safe = ensureSetRange(currentSetIdx);
  const nextStart = bound === 'start' ? safe.startId + delta : safe.startId;
  const nextEnd = bound === 'end' ? safe.endId + delta : safe.endId;
  applySetRange(nextStart, nextEnd);
  const input = document.getElementById(bound === 'start' ? 'quiz-range-start-input' : 'quiz-range-end-input');
  if (input) {
    input.classList.remove('stepper-pulse');
    void input.offsetWidth;
    input.classList.add('stepper-pulse');
  }
}

function incrementQuizCount(type, delta) {
  const isBookmark = type === 'bookmark';
  const input = document.getElementById(isBookmark ? 'bm-quiz-count-input' : 'quiz-count-input');
  if (!input || input.disabled) return;
  input.value = Number(input.value || 0) + delta;
  handleQuizCountInput(type);
  input.classList.remove('stepper-pulse');
  void input.offsetWidth;
  input.classList.add('stepper-pulse');
}

function getLimitedQuizWords(words, requestedCount) {
  const safeCount = sanitizeQuizCount(requestedCount, words.length);
  return shuffle(words).slice(0, safeCount);
}

function startNormalQuiz() {
  if (!commitSetRangeInput()) return;
  const activeWords = getActiveWords(currentSetIdx);
  if (activeWords.length === 0) {
    if (selectedRetest === 'bookmark') {
      alert('このセットにブックマーク済みの単語がありません。');
    } else {
      alert('このセットに学習中の単語がありません。');
    }
    return;
  }
  startQuizSession(shuffle(activeWords), 'normal');
}

function startReviewQuiz() {
  const wrongWords = getWrongWords();
  if (wrongWords.length === 0) { alert('復習対象の単語がありません。'); return; }
  startQuizSession(shuffle(wrongWords), 'review');
}

function startBookmarkQuiz() {
  const words = getBmFilteredWords();
  if (words.length === 0) { alert('表示中の単語がありません。'); return; }
  const selectedWords = getLimitedQuizWords(words, bookmarkQuizCount);
  quiz = {
    words: selectedWords,
    type: 'bookmark',
    idx: 0,
    mode: selectedBmMode,
    results: [],
    choices: null,
    answered: false,
  };
  updateQuizHeader();
  showScreen('screen-quiz');
  renderQuestion();
  scrollQuizToTop();
}

function startQuizSession(words, type) {
  quiz = {
    words, type,
    idx: 0,
    mode: selectedMode,
    results: [],
    choices: null,
    answered: false,
  };
  updateQuizHeader();
  showScreen('screen-quiz');
  renderQuestion();
  scrollQuizToTop();
}

function updateQuizHeader() {
  const modeLabels = { 1: '① 英語→日本語', 2: '② 日本語→英語', 3: '③ 日本語→英語（記述）' };
  const typeLabels = { normal: '通常クイズ', review: '復習テスト', bookmark: '★ブックマーク' };
  const typeClasses = { normal: 'type-normal', review: 'type-review', bookmark: 'type-bookmark' };
  document.getElementById('quiz-mode-tag').textContent = modeLabels[quiz.mode];
  const tt = document.getElementById('quiz-type-tag');
  tt.textContent = typeLabels[quiz.type] || quiz.type;
  tt.className = 'quiz-type-tag ' + (typeClasses[quiz.type] || 'type-normal');
}

function updateQuizProgress() {
  const total = quiz.words.length;
  const current = quiz.idx + 1;
  document.getElementById('quiz-progress-text').textContent = `${Math.min(current, total)} / ${total}`;
  document.getElementById('quiz-progress-fill').style.width = `${(quiz.idx / total) * 100}%`;
}

function renderQuestion() {
  if (quiz.idx >= quiz.words.length) { finishQuiz(); return; }
  const word = quiz.words[quiz.idx];
  quiz.answered = false;
  if (isAutoVoiceEnabled()) {
    const asksForEnglish = quiz.mode === 1;
    setTimeout(() => speakWordText(asksForEnglish ? word.en : word.jp, asksForEnglish ? 'en-US' : 'ja-JP'), 180);
  }
  updateQuizProgress();

  document.getElementById('answer-reveal-area').style.display = 'none';
  const answerUserBox = document.getElementById('answer-user-box');
  const autoJudgeBox = document.getElementById('answer-auto-judge');
  const manualJudgeButtons = document.getElementById('manual-judge-buttons');
  if (answerUserBox) answerUserBox.style.display = 'none';
  if (autoJudgeBox) autoJudgeBox.style.display = 'none';
  if (manualJudgeButtons) manualJudgeButtons.style.display = 'none';
  const nextBtn = document.getElementById('next-btn');
  nextBtn.style.display = 'none';
  nextBtn.className = 'next-btn';
  document.getElementById('btn-unknown').hidden = false;
  document.getElementById('btn-grade-mobile').hidden = quiz.mode !== 3;
  document.body.classList.remove('quiz-answer-shown');
  document.getElementById('correct-flash').classList.remove('show');
  document.getElementById('wrong-flash').classList.remove('show');

  const bmBtn = document.getElementById('quiz-bm-btn');
  if (bmBtn) {
    const bm = isBookmarked(word.id);
    bmBtn.textContent = bm ? '★' : '☆';
    bmBtn.classList.toggle('bookmarked', bm);
    bmBtn.title = bm ? 'ブックマーク解除' : 'ブックマークに追加';
  }

  const qWord = document.getElementById('q-word');
  const qMeaning = document.getElementById('q-meaning');
  const qPrompt = document.getElementById('q-prompt');
  const qSub = document.getElementById('q-sub');
  const qPhonetic = document.getElementById('q-phonetic');
  const container = document.getElementById('choices-container');
  if (qPhonetic) { qPhonetic.style.display = 'none'; qPhonetic.textContent = ''; }

  if (quiz.mode === 1) {
    qWord.style.display = 'block'; qMeaning.style.display = 'none';
    qWord.textContent = word.en;
    if (qPhonetic) {
      const phonetic = getWordPhonetic(word);
      qPhonetic.textContent = phonetic;
      qPhonetic.style.display = phonetic ? 'block' : 'none';
    }
    qPrompt.textContent = '次の英単語の意味として正しいものを選んでください';
    qSub.textContent = '';
    const choices = buildMode1Choices(word);
    quiz.choices = choices;
    container.innerHTML = '';
    
    const grid = document.createElement('div');
    grid.className = 'choices';
    grid.id = 'mode1-choices-grid';
    choices.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.textContent = c.text;
      btn.dataset.idx = i;
      btn.onclick = () => handleMode1Choice(i);
      grid.appendChild(btn);
    });
    container.appendChild(grid);

  } else if (quiz.mode === 2) {
    qWord.style.display = 'none'; qMeaning.style.display = 'block';
    qMeaning.textContent = word.jp;
    qPrompt.textContent = '次の意味に対応する英単語を1つ選んでください';
    qSub.textContent = '';
    const choices = buildMode2SingleChoices(word);
    quiz.choices = choices;
    quiz.mode2CorrectId = word.id;
    container.innerHTML = '';

    const grid = document.createElement('div');
    grid.className = 'choices';
    grid.id = 'mode2-choices-grid';
    choices.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.textContent = c.text;
      btn.dataset.idx = i;
      btn.onclick = () => handleMode2Choice(i);
      grid.appendChild(btn);
    });
    container.appendChild(grid);

  } else {
    qWord.style.display = 'none'; qMeaning.style.display = 'block';
    qMeaning.textContent = word.jp;
    qPrompt.textContent = 'この意味に対応する英単語を書いてください（自動採点）';
    qSub.textContent = '';
    container.innerHTML = `
      <input type="text" class="answer-input" id="free-answer" placeholder="英語で入力..." 
        onkeydown="if(event.key==='Enter')gradeTypedAnswer()" autocomplete="off" autocapitalize="none" spellcheck="false">
      <button class="confirm-btn" onclick="gradeTypedAnswer()">採点する</button>
    `;
  }

  const voiceButton = document.getElementById('quiz-voice-btn');
  if (voiceButton) {
    const label = quiz.mode === 1 ? '英単語を聞く' : '日本語の意味を聞く';
    voiceButton.title = label;
    voiceButton.setAttribute('aria-label', label);
  }
}

function handleMode1Choice(idx) {
  if (quiz.answered) return;
  unlockSound();
  quiz.answered = true;
  const word = quiz.words[quiz.idx];
  const choice = quiz.choices[idx];
  const isCorrect = choice.correct;

  const buttons = document.querySelectorAll('#choices-container .choice-btn');
  buttons.forEach((btn, i) => {
    btn.disabled = true;
    if (quiz.choices[i].correct) btn.classList.add('correct');
    else if (i === idx && !isCorrect) btn.classList.add('wrong');
  });

  const resultStatus = isCorrect ? '○' : '×'; // 正解はデフォルトで「○」
  flashResult(isCorrect);
  advanceProgress(word.id, resultStatus, 'q1');
  showNextBtn(isCorrect);
  setTimeout(()=>{ const nb=document.getElementById('next-btn'); if(nb){ nb.style.display='block'; nb.classList.add('is-visible'); } },120);
}

function handleMode2Choice(idx) {
  if (quiz.answered) return;
  unlockSound();
  quiz.answered = true;
  const word = quiz.words[quiz.idx];
  const choice = quiz.choices[idx];
  const isCorrect = choice.correct;

  const buttons = document.querySelectorAll('#choices-container .choice-btn');
  buttons.forEach((btn, i) => {
    btn.disabled = true;
    if (quiz.choices[i].correct) btn.classList.add('correct');
    else if (i === idx && !isCorrect) btn.classList.add('wrong');
  });

  const resultStatus = isCorrect ? '○' : '×';
  flashResult(isCorrect);
  advanceProgress(word.id, resultStatus, 'q2');
  showNextBtn(isCorrect);
}

function normalizeTypedAnswer(text) {
  return String(text || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ');
}

function normalizeTypedAnswerStrict(text) {
  return normalizeTypedAnswer(text).replace(/[^a-z0-9]/g, '');
}

function isTypedAnswerCorrect(input, correct) {
  const a = normalizeTypedAnswer(input);
  const b = normalizeTypedAnswer(correct);
  if (!a) return false;
  if (a === b) return true;
  return normalizeTypedAnswerStrict(a) === normalizeTypedAnswerStrict(b);
}

function gradeTypedAnswer() {
  if (quiz.answered) return;
  unlockSound();
  quiz.answered = true;

  const word = quiz.words[quiz.idx];
  const inputEl = document.getElementById('free-answer');
  const typedRaw = inputEl ? inputEl.value : '';
  const typedDisplay = typedRaw.trim();
  const isCorrect = isTypedAnswerCorrect(typedRaw, word.en);
  const resultStatus = isCorrect ? '○' : '×';

  const userBox = document.getElementById('answer-user-box');
  const userText = document.getElementById('answer-user-text');
  const judgeBox = document.getElementById('answer-auto-judge');
  const manualJudgeButtons = document.getElementById('manual-judge-buttons');

  if (userBox && userText) {
    userBox.style.display = 'block';
    userText.textContent = typedDisplay || '（未入力）';
    userText.classList.toggle('empty', !typedDisplay);
  }

  document.getElementById('answer-reveal-text').textContent = word.en;
  document.getElementById('answer-reveal-area').style.display = 'block';

  if (judgeBox) {
    judgeBox.style.display = 'block';
    judgeBox.className = 'answer-auto-judge ' + (isCorrect ? 'correct' : 'wrong');
    judgeBox.textContent = isCorrect
      ? '自動採点：正解です。'
      : '自動採点：不正解です。スペルを確認しましょう。';
  }
  if (manualJudgeButtons) manualJudgeButtons.style.display = 'none';

  const container = document.getElementById('choices-container');
  const qPhonetic = document.getElementById('q-phonetic');
  if (qPhonetic) { qPhonetic.style.display = 'none'; qPhonetic.textContent = ''; }
  container.innerHTML = '';

  flashResult(isCorrect);
  advanceProgress(word.id, resultStatus, 'q3');
  showNextBtn(isCorrect);
}

function showAnswer() {
  gradeTypedAnswer();
}

function selfJudge(grade) {
  if (quiz.answered) return;
  unlockSound();
  quiz.answered = true;
  document.getElementById('answer-reveal-area').style.display = 'none';
  const word = quiz.words[quiz.idx];
  const isCorrect = grade !== 'cross';
  const statusMap = { dcircle: '◎', circle: '○', cross: '×' };
  const resultStatus = statusMap[grade];
  flashResult(isCorrect);
  advanceProgress(word.id, resultStatus, 'q3');
  showNextBtn(isCorrect);
}

function flashResult(isCorrect) {
  if (isCorrect) playCorrectSound();
  else playWrongSound();
  const el = document.getElementById(isCorrect ? 'correct-flash' : 'wrong-flash');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1150);
}

function showNextBtn(isCorrect) {
  const btn = document.getElementById('next-btn');
  document.getElementById('btn-unknown').hidden = true;
  document.getElementById('btn-grade-mobile').hidden = true;
  const word = quiz.words[quiz.idx];
  quiz.results.push({ wordId: word.id, correct: isCorrect });
  leaderboardStats.totalAnswered = (leaderboardStats.totalAnswered || 0) + 1;
  if (isCorrect) leaderboardStats.totalCorrect = (leaderboardStats.totalCorrect || 0) + 1;
  else leaderboardStats.totalWrong = (leaderboardStats.totalWrong || 0) + 1;
  leaderboardStats.updatedAt = new Date().toISOString();
  saveProgress();
  syncLeaderboardProfile();
  btn.style.display = 'block';
  btn.classList.add('is-visible');
  document.body.classList.add('quiz-answer-shown');
  if (quiz.idx + 1 >= quiz.words.length) {
    btn.textContent = '結果を見る →';
  } else {
    btn.textContent = isCorrect ? '✓ 次の問題へ →' : '✗ 次の問題へ →';
  }
  btn.className = 'next-btn is-visible ' + (isCorrect ? 'correct-next' : 'wrong-next'); btn.style.display='block';
}

function skipUnknownQuestion() {
  if (quiz.answered || !quiz.words[quiz.idx]) return;
  quiz.answered = true;
  const word = quiz.words[quiz.idx];
  document.activeElement?.blur();
  if (quiz.mode === 3) {
    document.getElementById('answer-reveal-text').textContent = word.en;
    document.getElementById('answer-reveal-area').style.display = 'block';
    document.getElementById('answer-user-box').style.display = 'none';
    document.getElementById('answer-auto-judge').style.display = 'none';
    document.getElementById('choices-container').replaceChildren();
  } else {
    document.querySelectorAll('#choices-container .choice-btn').forEach((button, i) => {
      button.disabled = true;
      if (quiz.choices[i]?.correct) button.classList.add('correct');
    });
    const info = document.createElement('div');
    info.className = 'skip-answer';
    info.textContent = `答え：${word.en} — ${word.jp}`;
    document.getElementById('choices-container').appendChild(info);
  }
  advanceProgress(word.id, '×', 'q' + quiz.mode);
  showNextBtn(false);
}

function advanceProgress(wordId, resultStatus, quizNum) {
  if (quizNum && resultStatus) {
    setQResult(wordId, quizNum, resultStatus);
  }
  saveProgress();
}

function nextQuestion() {
  quiz.idx++;
  renderQuestion();
  if (quiz.idx < quiz.words.length) scrollQuizToTop();
}

function finishQuiz() {
  const correct = quiz.results.filter(r => r.correct).length;
  const wrong = quiz.results.length - correct;
  
  const titleEl = document.getElementById('result-title');
  const subEl = document.getElementById('result-sub');
  const statsEl = document.getElementById('result-stats');
  const btnsEl = document.getElementById('result-btns');

  const typeLabel = { normal: '通常クイズ', review: '復習テスト', bookmark: '★ブックマーク' }[quiz.type];
  titleEl.textContent = `${typeLabel}完了！`;
  subEl.textContent = `全${quiz.results.length}問`;
  
  statsEl.innerHTML = `
    <div class="result-stat-item correct">
      <div class="result-stat-num">${correct}</div>
      <div class="result-stat-label">正解</div>
    </div>
    <div class="result-stat-item wrong">
      <div class="result-stat-num">${wrong}</div>
      <div class="result-stat-label">不正解</div>
    </div>
  `;
  renderHomeRankingPanel();

  const wrongWords = getWrongWords();
  let btnsHTML = '';
  if (quiz.type === 'normal') {
    btnsHTML += `<button class="btn btn-primary" onclick="showSet(${currentSetIdx})">セットに戻る</button>`;
  } else if (quiz.type === 'bookmark') {
    btnsHTML += `<button class="btn" style="background:var(--bookmark);color:#fff;" onclick="showBookmarks()">📋 マイリストに戻る</button>`;
  } else {
    btnsHTML += `<button class="btn btn-primary" onclick="showHome()">ホームへ</button>`;
  }
  if (wrongWords.length >= WRONG_THRESHOLD) {
    btnsHTML += `<button class="btn btn-review" onclick="startReviewQuiz()">⚠ 復習リスト（${wrongWords.length}問）</button>`;
  }
  btnsHTML += `<button class="btn btn-secondary" onclick="showHome()">ホームへ</button>`;
  btnsEl.innerHTML = btnsHTML;

  playFinishSound();
  showScreen('screen-result');
}

// =========================================================
// RENDER HOME
// =========================================================
function renderHome() {
  const stats = getTotalStats();
  const total = WORDS.length;
  const done = stats['○'] + stats['◎'] + stats['×'];
  document.getElementById('home-stats').innerHTML = `
    <div class="home-stat total"><div class="home-stat-num">${total}</div><div class="home-stat-label">総単語数</div></div>
    <div class="home-stat s-○"><div class="home-stat-num">${stats['○']}</div><div class="home-stat-label">○</div></div>
    <div class="home-stat s-◎"><div class="home-stat-num">${stats['◎']}</div><div class="home-stat-label">◎</div></div>
    <div class="home-stat s-×"><div class="home-stat-num">${stats['×']}</div><div class="home-stat-label">×</div></div>
    <div style="flex:1;margin-left:8px;">
      <div style="font-size:11px;color:var(--text2);margin-bottom:6px;font-weight:bold;">全体進捗 ${done}/${total}</div>
      <div class="progress-bar" style="height:10px;">
        <div class="progress-seg circle" style="width:${(stats['○']/total*100).toFixed(1)}%"></div>
        <div class="progress-seg dcircle" style="width:${(stats['◎']/total*100).toFixed(1)}%"></div>
        <div class="progress-seg cross" style="width:${(stats['×']/total*100).toFixed(1)}%"></div>
      </div>
    </div>
  `;
  renderHomeRankingPanel();

  const wrongWords = getWrongWords();
  const alertEl = document.getElementById('home-alert');

  const bmCount = bookmarks.size;
  const wrongCount = getWrongWords().length;
  const reviewEntry = document.querySelector('#screen-home .review-entry');
  if (reviewEntry) reviewEntry.hidden = wrongCount < WRONG_THRESHOLD;
  const myListCount = new Set([...Array.from(bookmarks), ...getWrongWords().map(w => w.id)]).size;
  const bmPanelEl = document.getElementById('home-bookmark-panel');
  if (bmPanelEl) {
    if (myListCount > 0 && wrongCount >= WRONG_THRESHOLD) {
      const parts = [];
      if (bmCount > 0) parts.push(`★ ${bmCount}語`);
      if (wrongCount > 0) parts.push(`× ${wrongCount}語`);
      bmPanelEl.innerHTML = `
        <div class="bookmark-panel" onclick="showBookmarks()">
          <div class="bookmark-panel-icon">📋</div>
          <div class="bookmark-panel-info">
            <div class="bookmark-panel-title">マイリスト</div>
            <div class="bookmark-panel-sub">${parts.join(' ／ ')} — まとめて復習できます</div>
          </div>
          <div class="bookmark-panel-count">${myListCount}<span style="font-size:14px;color:var(--text2);margin-left:4px;">語</span></div>
        </div>`;
    } else {
      bmPanelEl.innerHTML = '';
    }
  }

  if (wrongWords.length >= WRONG_THRESHOLD) {
    alertEl.innerHTML = `
      <div class="alert-banner" onclick="startReviewQuiz()">
        <div class="alert-icon">⚠</div>
        <div class="alert-text">
          <div class="alert-title">間違えた単語が${wrongWords.length}語あります</div>
          <div class="alert-sub">×になった単語が溜まっています。今すぐ復習しましょう。</div>
        </div>
        <button class="alert-btn">復習する</button>
      </div>
    `;
  } else {
    alertEl.innerHTML = '';
  }

  renderClassStudyShortcut();
  const grid = document.getElementById('sets-grid');
  if (grid.querySelector('.quiz-options')) return;
  grid.innerHTML = `<button type="button" class="set-card word-picker-card" onclick="showSet(0)">
    <div class="set-title">単語を選ぶ →</div>
    <div class="set-range">全${WORDS.length}語から番号範囲を選択</div>
    <div class="progress-bar"><div class="progress-seg circle" style="width:${(stats['○']/total*100).toFixed(1)}%"></div><div class="progress-seg dcircle" style="width:${(stats['◎']/total*100).toFixed(1)}%"></div><div class="progress-seg cross" style="width:${(stats['×']/total*100).toFixed(1)}%"></div></div>
    <div class="set-stats"><span class="stat-item stat-none">未 ${stats['']}</span><span class="stat-item stat-○">○ ${stats['○']}</span><span class="stat-item stat-◎">◎ ${stats['◎']}</span><span class="stat-item stat-×">× ${stats['×']}</span></div>
  </button>`;
}


// =========================================================
// WORD SEARCH
// =========================================================
let wordSearchQuery = '';

function normalizeWordSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function setWordSearchQuery(value) {
  wordSearchQuery = String(value || '');
  renderSet();
}

function clearWordSearch() {
  wordSearchQuery = '';
  const input = document.getElementById('word-search-input');
  if (input) input.value = '';
  renderSet();
}

function isWordSearchMatch(word, query) {
  const q = normalizeWordSearchText(query);
  if (!q) return true;
  const haystack = normalizeWordSearchText(`${word.id} ${word.en} ${word.jp}`);
  return haystack.includes(q);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlightWordSearch(value) {
  const raw = String(value || '');
  const q = normalizeWordSearchText(wordSearchQuery);
  if (!q) return escapeHtml(raw);
  const escaped = escapeHtml(raw);
  const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return escaped.replace(new RegExp(`(${safeQ})`, 'ig'), '<mark class="word-search-mark">$1</mark>');
  } catch (e) {
    return escaped;
  }
}

// =========================================================
// RENDER SET
// =========================================================
function renderSet() {
  const range = ensureSetRange(currentSetIdx);
  const words = WORDS.filter(w => w.id >= range.startId && w.id <= range.endId).slice(0, 100);
  document.getElementById('set-screen-title').textContent = '単語を選ぶ';
  document.getElementById('set-screen-sub').textContent = `${range.startId}〜${range.endId}番 / ${range.endId-range.startId+1}語を選択中`;

  updateSetRangeUI();
  const modeSelect = document.getElementById('mode-select');
  if (modeSelect) modeSelect.value = String(selectedMode);
  const retestSelect = document.getElementById('retest-select');
  if (retestSelect) retestSelect.value = selectedRetest;
  syncMobileStudyChoices();

  const activeWords = getActiveWords(currentSetIdx);
  const startBtn = document.getElementById('btn-start-quiz');

  startBtn.disabled = activeWords.length === 0;
  startBtn.textContent = activeWords.length > 0
    ? `▶ ${range.startId}〜${range.endId}番でクイズ開始（${activeWords.length}語）`
    : `▶ ${range.startId}〜${range.endId}番は出題対象なし`;

  const body = document.getElementById('word-table-body');
  let html = '';
  words.forEach(w => {
    const inRange = w.id >= range.startId && w.id <= range.endId;
    const s = getStatus(w.id);
    const qp = getQProgress(w.id);
    const bm = isBookmarked(w.id);
    const newBadge = w.isNew ? '<span class="new-badge">新</span>' : '';
    const manualBtn = s === '○' ? `<button class="manual-up-btn" onclick="manualUpgrade(${w.id},event)" title="◎に昇格">▲◎</button>` : '';
    const q1b = qp.q1 ? `<span class="mini-badge mini-badge-q1">①${qp.q1}</span>` : '';
    const q2b = qp.q2 ? `<span class="mini-badge mini-badge-q2">②${qp.q2}</span>` : '';
    const q3b = qp.q3 ? `<span class="mini-badge mini-badge-q3">③${qp.q3}</span>` : '';
    html += `
      <div class="word-row" style="${inRange ? '' : 'opacity:0.45;'}">
        <span><button class="bookmark-btn${bm ? ' bookmarked' : ''}" onclick="toggleBookmarkRow(${w.id},event)" title="${bm ? 'ブックマーク解除' : 'ブックマーク追加'}">${bm ? '★' : '☆'}</button></span>
        <span class="word-num">${w.id}</span>
        <span class="word-en"><button class="word-voice-btn" onclick="speakWordById(${w.id},event)" title="発音を聞く">🔊</button>${highlightWordSearch(w.en)}${newBadge}</span>
        <span class="word-jp">${highlightWordSearch(w.jp)}${inRange ? '' : ' <span style="font-size:10px;color:var(--text2);">(範囲外)</span>'}</span>
        <span class="word-status">
          <span class="badge badge-${s || 'none'}">${s || '―'}</span>
          ${manualBtn}
          <span class="word-quiz-badges">${q1b}${q2b}${q3b}</span>
        </span>
      </div>
    `;
  });
  body.innerHTML = html + (range.endId - range.startId >= 100 ? '<div class="range-preview-note">プレビューは先頭100語を表示しています。クイズには選択した全単語が含まれます。</div>' : '');
}

function toggleBookmarkRow(wordId, event) {
  event.stopPropagation();
  toggleBookmark(wordId);
  renderSet();
}

function toggleQuizBookmark() {
  if (!quiz) return;
  const word = quiz.words[quiz.idx];
  toggleBookmark(word.id);
  const bmBtn = document.getElementById('quiz-bm-btn');
  const bm = isBookmarked(word.id);
  bmBtn.textContent = bm ? '★' : '☆';
  bmBtn.classList.toggle('bookmarked', bm);
  bmBtn.title = bm ? 'ブックマーク解除' : 'ブックマークに追加';
}

function manualUpgrade(wordId, event) {
  event.stopPropagation();
  if (getStatus(wordId) === '○') {
    const qn = 'q' + selectedMode;
    if (confirm(`「${WORD_MAP[wordId].en}」を○→◎に手動昇格しますか？`)) {
      setQResult(wordId, qn, '◎');
      saveProgress();
      syncLeaderboardProfile();
      renderSet();
    }
  }
}

// =========================================================
// RENDER BOOKMARKS
// =========================================================
function getBmFilteredWords() {
  if (selectedBmFilter === 'bm') return getBookmarkedWords();
  if (selectedBmFilter === 'wrong') return getWrongWords();
  const ids = new Set([
    ...Array.from(bookmarks),
    ...getWrongWords().map(w => w.id)
  ]);
  return WORDS.filter(w => ids.has(w.id));
}

function setBmFilter(filter) {
  selectedBmFilter = filter;
  renderBookmarks();
}

function renderBookmarks() {
  const bmWords    = getBookmarkedWords();
  const wrongWords = getWrongWords();
  const allWords   = (() => {
    const ids = new Set([...Array.from(bookmarks), ...wrongWords.map(w => w.id)]);
    return WORDS.filter(w => ids.has(w.id));
  })();

  document.getElementById('bm-cnt-all').textContent   = allWords.length;
  document.getElementById('bm-cnt-bm').textContent    = bmWords.length;
  document.getElementById('bm-cnt-wrong').textContent = wrongWords.length;

  ['all','bm','wrong'].forEach(f => {
    const btn = document.getElementById('bm-filter-' + f);
    if (!btn) return;
    btn.className = 'bm-filter-btn' + (selectedBmFilter === f ? ' active-' + f : '');
  });

  const displayWords = getBmFilteredWords();
  const titleMap = { all: 'マイリスト', bm: '★ ブックマーク', wrong: '× 間違い一覧' };
  const titleEl = document.getElementById('bm-screen-title');
  if (titleEl) titleEl.textContent = titleMap[selectedBmFilter];
  document.getElementById('bm-screen-sub').textContent = `${displayWords.length}語`;

  const quizBtn = document.getElementById('btn-bm-quiz');
  if (quizBtn) {
    quizBtn.disabled = displayWords.length === 0;
    const currentCount = syncQuizCountUI('bookmark', displayWords.length);
    const btnLabelMap = {
      all: '▶ マイリストクイズ',
      bm:  '★ ブックマーククイズ',
      wrong: '× 間違い語句クイズ'
    };
    const btnColorMap = {
      all:   'var(--gold)',
      bm:    'var(--bookmark)',
      wrong: 'var(--cross)'
    };
    quizBtn.textContent = displayWords.length > 0
      ? `${btnLabelMap[selectedBmFilter]} (${currentCount} / ${displayWords.length}語)`
      : btnLabelMap[selectedBmFilter];
    quizBtn.style.background = btnColorMap[selectedBmFilter];
    quizBtn.style.color = '#fff';
  }

  const listEl = document.getElementById('bm-word-list');

  if (displayWords.length === 0) {
    const emptyMsgMap = {
      all:   ['📋', 'マイリストが空です', 'ブックマーク（☆）を追加するか、クイズで×をつけると表示されます'],
      bm:    ['☆',  'ブックマークがありません', '単語リストの ☆ ボタン、またはクイズ中の ☆ でブックマークできます'],
      wrong: ['✗',  '×の単語がありません', 'クイズで間違えた単語がここに表示されます'],
    };
    const [icon, text, sub] = emptyMsgMap[selectedBmFilter];
    listEl.innerHTML = `
      <div class="bm-empty">
        <div class="bm-empty-icon">${icon}</div>
        <div class="bm-empty-text">${text}</div>
        <div class="bm-empty-sub">${sub}</div>
      </div>`;
    return;
  }

  let html = `
    <div class="word-table-wrap">
      <div class="word-table-header" style="grid-template-columns:28px 40px 120px 1fr 90px 32px;">
        <span></span><span>No.</span><span>英語</span><span>意味</span><span>進捗</span><span></span>
      </div>
      <div class="word-table-scroll">`;

  displayWords.forEach(w => {
    const s   = getStatus(w.id);
    const bm  = isBookmarked(w.id);
    const isWrong = s === '×';
    const newBadge = w.isNew ? '<span class="new-badge">新</span>' : '';
    const wrongTag = isWrong ? '<span class="cross-indicator">×</span>' : '';
    const bmStar = bm
      ? `<button class="bookmark-btn bookmarked" style="display:block;" onclick="toggleBookmarkBm(${w.id},event)" title="ブックマーク解除">★</button>`
      : `<button class="bookmark-btn" onclick="toggleBookmarkBm(${w.id},event)" title="ブックマーク追加">☆</button>`;

    html += `
      <div class="word-row" style="grid-template-columns:28px 40px 120px 1fr 90px 32px;">
        <span></span>
        <span class="word-num">${w.id}</span>
        <span class="word-en"><button class="word-voice-btn" onclick="speakWordById(${w.id},event)" title="発音を聞く">🔊</button>${w.en}${newBadge}${wrongTag}</span>
        <span class="word-jp">${w.jp}</span>
        <span class="word-status"><span class="badge badge-${s || 'none'}">${s || '―'}</span></span>
        <span>${bmStar}</span>
      </div>`;
  });

  html += `</div></div>`;
  listEl.innerHTML = html;
}

function toggleBookmarkBm(wordId, event) {
  event.stopPropagation();
  toggleBookmark(wordId);
  renderBookmarks();
}

// =========================================================
// INIT
// =========================================================
async function init() {
  if (document.body && document.body.dataset && document.body.dataset.rolePage) {
    await initRolePage(document.body.dataset.rolePage);
    return;
  }
  loadProgress();
  restoreClassAssignment();
  window.addEventListener('online', refreshClassTestRange);
  const redirected = await enforceMaintenanceMode();
  if (redirected) return;
  document.getElementById('loading-screen').style.display = 'none';
  renderAuthFab();
  if (!openSharedSelection()) showHome();
  refreshClassTestRange();
  showWelcomeModalIfNeeded();
  if (new URLSearchParams(location.search).get('view') === 'account') showAccountSettings();
}

init().catch(e => {
  console.warn('init error:', e);
  document.getElementById('loading-screen').style.display = 'none';
  renderAuthFab();
  if (!openSharedSelection()) showHome();
});

function showAuthModal() {
  const modal = document.getElementById('auth-choice-modal');
  if (!modal) { const page = document.body.dataset.rolePage; const target = ['admin','teacher'].includes(page) ? page : 'account'; location.href = './login.html?return=' + target; return; }
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => {
    const email = document.getElementById('auth-email-input');
    if (email && window.innerWidth > 700) email.focus();
  }, 120);
}

function closeAuthModal() {
  const modal = document.getElementById('auth-choice-modal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  if (onboardingAuthOpen) { onboardingAuthOpen = false; advanceOnboarding(); }
}

function login(){
  showAuthModal();
}

function getEmailAuthValues() {
  const email = (document.getElementById('auth-email-input')?.value || '').trim();
  const password = document.getElementById('auth-password-input')?.value || '';
  return { email, password };
}

function authErrorMessage(e) {
  const code = e && e.code;
  if (code === 'auth/invalid-email') return 'メールアドレスの形式を確認してください';
  if (code === 'auth/user-not-found') return 'このメールアドレスは登録されていません';
  if (code === 'auth/wrong-password') return 'パスワードが違います';
  if (code === 'auth/email-already-in-use') return 'このメールアドレスは登録済みです';
  if (code === 'auth/weak-password') return 'パスワードは6文字以上にしてください';
  if (code === 'auth/operation-not-allowed') return 'このログイン方法は現在利用できません。別の方法をお試しください。';
  if (code === 'auth/popup-closed-by-user') return 'ログイン画面が閉じられました';
  return 'ログインできませんでした。入力内容を確認して、もう一度お試しください。';
}

async function loginGoogle(){
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await auth.signInWithPopup(provider);
    storeClassAssignment(null);
    closeAuthModal();
    markWelcomeAccepted();
    showSyncStatus('Googleでログインしました');
  } catch (e) {
    console.warn('loginGoogle error:', e);
    showSyncStatus(authErrorMessage(e), true);
  }
}

async function loginEmail(){
  const { email, password } = getEmailAuthValues();
  if (!email || !password) { showSyncStatus('メールアドレスとパスワードを入力してください', true); return; }
  try {
    await auth.signInWithEmailAndPassword(email, password);
    storeClassAssignment(null);
    closeAuthModal();
    markWelcomeAccepted();
    showSyncStatus('メールでログインしました');
  } catch (e) {
    console.warn('loginEmail error:', e);
    showSyncStatus(authErrorMessage(e), true);
  }
}

async function signupEmail(){
  const { email, password } = getEmailAuthValues();
  if (!email || !password) { showSyncStatus('メールアドレスとパスワードを入力してください', true); return; }
  try {
    await auth.createUserWithEmailAndPassword(email, password);
    storeClassAssignment(null);
    closeAuthModal();
    markWelcomeAccepted();
    showSyncStatus('新規登録してログインしました');
  } catch (e) {
    console.warn('signupEmail error:', e);
    showSyncStatus(authErrorMessage(e), true);
  }
}

async function resetPassword(){
  const { email } = getEmailAuthValues();
  if (!email) { showSyncStatus('リセット用のメールアドレスを入力してください', true); return; }
  try {
    await auth.sendPasswordResetEmail(email);
    showSyncStatus('パスワード再設定メールを送信しました');
  } catch (e) {
    console.warn('resetPassword error:', e);
    showSyncStatus(authErrorMessage(e), true);
  }
}

function startWithoutLogin(){
  storeClassAssignment(null);
  closeAuthModal();
  markWelcomeAccepted();
  showSyncStatus('ログインなしで開始しました');
}


document.addEventListener('keydown', (e) => {
  const modal = document.getElementById('auth-choice-modal');
  if (!modal || !modal.classList.contains('show')) return;
  if (e.key === 'Escape') closeAuthModal();
  if (e.key === 'Enter' && (document.activeElement?.id === 'auth-email-input' || document.activeElement?.id === 'auth-password-input')) {
    loginEmail();
  }
});

async function logout(){
  try {
    await auth.signOut();
    storeClassAssignment(null);
    showSyncStatus('ログアウトしました');
  } catch (e) {
    console.warn('logout error:', e);
    showSyncStatus('ログアウトに失敗しました', true);
  }
}

auth.onAuthStateChanged(async user => {
  if (user) {
    if (await enforceUserSuspendedState(user)) return;
    await loadAccountProfile();
    await loadSchoolCodeFromProfile();
    await refreshClassTestRange();
      renderClassStudyShortcut();
    renderAuthFab();
    console.log('ログイン:', user.uid);
    await restoreCloudProgress();
    await syncLeaderboardProfile();
    await fetchLeaderboard();
    renderHomeRankingPanel();
    if (document.getElementById('screen-ranking') && document.getElementById('screen-ranking').classList.contains('active')) {
      renderRanking();
    }
    if (document.getElementById('screen-account') && document.getElementById('screen-account').classList.contains('active')) {
      renderAccountSettings();
    }
  } else {
    accountProfile = { nickname: '' };
    accountSettingsTab = 'profile';
    renderClassStudyShortcut();
    renderAuthFab();
    leaderboardCache = [];
    myLeaderboardRank = null;
    renderHomeRankingPanel();
    if (document.getElementById('screen-ranking') && document.getElementById('screen-ranking').classList.contains('active')) {
      renderRanking();
    }
    if (document.getElementById('screen-account') && document.getElementById('screen-account').classList.contains('active')) {
      renderAccountSettings();
    }
  }
});

window.addEventListener('beforeunload', () => {
  if (auth.currentUser) {
    saveCloudProgress();
  }
});

// =========================================================
// UI POLISH HELPERS 2026
// =========================================================
(function(){
  function getActiveScreenId(){
    const active = document.querySelector('.screen.active');
    return active ? active.id : '';
  }

  async function updateRoleNavButtons(){
    // 先生・管理メニューは下部バーから独立させず、「設定」内に統合。
    // 下部バーは ホーム / 復習 / 順位 / 設定 の4項目に固定する。
  }

  function updateUiState(){
    const id = getActiveScreenId();
    document.body.classList.toggle('is-quiz-active', id === 'screen-quiz');
    const nav = document.getElementById('mobile-bottom-nav');
    if (!nav) return;
    nav.classList.toggle('hidden', id === 'screen-quiz');
    nav.querySelectorAll('button[data-target]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.target === id);
      if (btn.dataset.target === 'screen-account') btn.querySelector('span:last-child').textContent = auth.currentUser || activeClassAssignment?.local ? 'マイページ' : 'ログイン';
    });
    updateRoleNavButtons();
  }

  function buildBottomNav(){
    if (document.getElementById('mobile-bottom-nav')) return;
    const nav = document.createElement('nav');
    nav.id = 'mobile-bottom-nav';
    nav.className = 'mobile-bottom-nav';
    nav.setAttribute('aria-label', '主要ナビゲーション');
    const icon = (paths) => `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    nav.innerHTML = `
      <button type="button" data-target="screen-home" onclick="showHome()">${icon('<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>')}<span>学習</span></button>
      <button type="button" data-target="screen-bookmark" onclick="showBookmarks()">${icon('<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/><path d="M8 10h5M8 13h3"/>')}<span>復習・検索</span></button>
      <button type="button" data-target="screen-results-dashboard" onclick="showResultsDashboard()">${icon('<path d="M4 20V12m5 8V8m5 12v-5m5 5V4"/><path d="M3 4h5l4 4 4-4h5"/>')}<span>成績</span></button>
      <button type="button" data-target="screen-account" onclick="showAccountTab()">${icon('<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>')}<span>ログイン</span></button>
    `;
    document.body.appendChild(nav);
  }

  function wrapScreenFunction(name){
    if (typeof window[name] !== 'function') return;
    const original = window[name];
    if (original.__uiPolished) return;
    const wrapped = function(){
      const result = original.apply(this, arguments);
      setTimeout(updateUiState, 0);
      return result;
    };
    wrapped.__uiPolished = true;
    window[name] = wrapped;
  }

  buildBottomNav();
  let previousScrollY = window.scrollY;
  let scrollFramePending = false;
  window.addEventListener('scroll', () => {
    if (scrollFramePending) return;
    scrollFramePending = true;
    requestAnimationFrame(() => {
      const currentY = window.scrollY;
      const nav = document.getElementById('mobile-bottom-nav');
      if (nav && window.matchMedia('(max-width: 700px)').matches && !document.body.classList.contains('is-quiz-active')) {
        if (currentY > 90 && currentY > previousScrollY + 8) nav.classList.add('compact');
        else if (currentY < previousScrollY - 8 || currentY < 40) nav.classList.remove('compact');
      }
      previousScrollY = currentY;
      scrollFramePending = false;
    });
  }, { passive: true });
  document.querySelector('.study-word-list')?.addEventListener('toggle', event => {
    const summary = event.currentTarget.querySelector('summary');
    if (summary) summary.textContent = event.currentTarget.open ? '単語リストを閉じる' : '単語リストを開く';
  });
  ['showHome','showSearch','showProgress','showResultsDashboard','showAccountTab','showBookmarks','showRanking','showAccountSettings','showSetScreen','showQuiz','showResult','quitQuiz','nextQuestion'].forEach(wrapScreenFunction);
  try {
    if (auth && typeof auth.onAuthStateChanged === 'function') {
      auth.onAuthStateChanged(() => setTimeout(updateUiState, 80));
    }
  } catch (e) {}

  const app = document.getElementById('app');
  if (app && 'MutationObserver' in window) {
    new MutationObserver(updateUiState).observe(app, { attributes: true, subtree: true, attributeFilter: ['class'] });
  }
  window.addEventListener('resize', updateUiState, { passive: true });
  setTimeout(updateUiState, 0);
})();

// =========================================================
// PWA INSTALL HELPER
// =========================================================
let deferredPwaPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPwaPrompt = event;
  window.dispatchEvent(new Event('pwa-install-ready'));
});
window.addEventListener('appinstalled', () => {
  deferredPwaPrompt = null;
  if (typeof showSyncStatus === 'function') showSyncStatus('アプリとしてインストールされました');
});
async function installPwaApp() {
  if (!deferredPwaPrompt) {
    if (typeof showSyncStatus === 'function') showSyncStatus('ブラウザの「ホーム画面に追加」からインストールできます');
    return;
  }
  deferredPwaPrompt.prompt();
  await deferredPwaPrompt.userChoice.catch(() => null);
  deferredPwaPrompt = null;
}
(function addPwaButtonToAccountScreen(){
  function ensureButton(){
    const screen = document.getElementById('screen-account');
    if (!screen || document.getElementById('btn-install-pwa')) return;
    const cards = screen.querySelectorAll('.account-card');
    const target = cards[cards.length - 1] || screen.querySelector('.content');
    if (!target) return;
    const box = document.createElement('div');
    box.className = 'account-privacy-item';
    box.style.marginTop = '12px';
    box.innerHTML = '<span class="account-privacy-icon">📱</span><span><strong>アプリとして使う</strong><br>ホーム画面に追加すると、次回から通信量を抑えてすばやく開けます。<br><button id="btn-install-pwa" class="btn btn-secondary" style="margin-top:10px" onclick="installPwaApp()">ホーム画面に追加</button></span>';
    target.appendChild(box);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureButton);
  else ensureButton();
  window.addEventListener('pwa-install-ready', ensureButton);
})();

// =========================================================
// FULL UI UPGRADE HELPERS 2026-04
// 既存ロジックを壊さず、導線・検索・キーボード操作・表示状態だけを追加
// =========================================================
(function(){
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  let setFilter = 'all';
  let setSearch = '';

  function toast(message) {
    let el = $('#ui-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ui-toast';
      el.className = 'ui-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 1800);
  }
  window.uiToast = toast;

  function getStatsSafe(){
    try { return typeof getTotalStats === 'function' ? getTotalStats() : {'':0,'○':0,'◎':0,'×':0}; }
    catch(e){ return {'':0,'○':0,'◎':0,'×':0}; }
  }

  function nextRecommendedSet(){
    try {
      if (typeof TOTAL_SETS !== 'number' || typeof isSetCompleted !== 'function' || typeof getSetStats !== 'function') return 0;
      for (let i=0; i<TOTAL_SETS; i++) {
        if (!isSetCompleted(i)) {
          const s = getSetStats(i);
          if ((s['○'] || 0) + (s['×'] || 0) + (s['◎'] || 0) > 0) return i;
        }
      }
      for (let i=0; i<TOTAL_SETS; i++) if (!isSetCompleted(i)) return i;
    } catch(e) {}
    return 0;
  }

  function ensureHomeCommandCenter(){
    const content = $('#screen-home .content');
    const existing = $('#home-command-center');
    if ((getStatsSafe()['×'] || 0) < WRONG_THRESHOLD) { existing?.remove(); return; }
    const before = $('#home-bookmark-panel');
    if (!content || !before || before.parentElement !== content) return;
    let box = $('#home-command-center');
    const stats = getStatsSafe();
    const total = typeof WORDS !== 'undefined' ? WORDS.length : ((stats['']||0)+(stats['○']||0)+(stats['◎']||0)+(stats['×']||0));
    const done = (stats['○']||0) + (stats['◎']||0) + (stats['×']||0);
    const percent = total ? Math.round(done / total * 100) : 0;
    const wrong = stats['×'] || 0;
    if (wrong < WRONG_THRESHOLD) { box?.remove(); return; }
    const rec = nextRecommendedSet();
    if (!box) {
      box = document.createElement('div');
      box.id = 'home-command-center';
      box.className = 'home-command-center';
      content.insertBefore(box, before);
    }
    box.innerHTML = `
      <div>
        <div class="home-command-kicker">Today&apos;s study</div>
        <div class="home-command-title">全体進捗 ${percent}% — 次は Unit ${rec + 1} から</div>
        <div class="home-command-sub">迷ったら「続きから」。×が多い日は復習を先にすると定着しやすいです。</div>
      </div>
      <div class="home-command-actions">
        <button type="button" class="ui-chip-btn primary" onclick="showSet(${rec})">続きから</button>
        <button type="button" class="ui-chip-btn danger" ${wrong ? 'onclick="startReviewQuiz()"' : 'disabled'}>×復習 ${wrong}</button>
        <button type="button" class="ui-chip-btn" onclick="showBookmarks()">マイリスト</button>
      </div>`;
  }

  function ensureHomeTools(){
    const title = $$('#screen-home .section-title').find(el => /学習セット/.test(el.textContent || ''));
    const grid = $('#sets-grid');
    if (!title || !grid || grid.querySelector('.word-picker-card')) return;
    let tools = $('#home-tools');
    if (!tools) {
      tools = document.createElement('div');
      tools.id = 'home-tools';
      tools.className = 'home-tools';
      tools.innerHTML = `
        <input id="home-set-search" class="home-search" type="search" placeholder="Unit番号で検索（例: 12）" autocomplete="off">
        <div class="home-filter-pills" aria-label="セット表示フィルター">
          <button type="button" class="ui-chip-btn active" data-filter="all">すべて</button>
          <button type="button" class="ui-chip-btn" data-filter="active">学習中</button>
          <button type="button" class="ui-chip-btn" data-filter="done">完了</button>
        </div>`;
      title.insertAdjacentElement('afterend', tools);
      $('#home-set-search', tools).addEventListener('input', e => { setSearch = e.target.value.trim(); applySetFilters(); });
      $$('.home-filter-pills button', tools).forEach(btn => {
        btn.addEventListener('click', () => {
          setFilter = btn.dataset.filter || 'all';
          $$('.home-filter-pills button', tools).forEach(b => b.classList.toggle('active', b === btn));
          applySetFilters();
        });
      });
    }
    const input = $('#home-set-search', tools);
    if (input && input.value !== setSearch) input.value = setSearch;
    applySetFilters();
  }

  function applySetFilters(){
    const q = String(setSearch || '').replace(/[^0-9]/g, '');
    $$('#sets-grid .set-card').forEach((card, idx) => {
      const active = !!card.querySelector('.tag-active');
      const done = card.classList.contains('completed') || !!card.querySelector('.tag-done');
      let ok = true;
      if (setFilter === 'active') ok = active;
      if (setFilter === 'done') ok = done;
      if (q) ok = ok && String(idx + 1).includes(q);
      card.hidden = !ok;
      card.setAttribute('tabindex', ok ? '0' : '-1');
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Unit ${idx + 1} を開く`);
      if (!card.dataset.keyReady) {
        card.addEventListener('keydown', ev => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); card.click(); }
        });
        card.dataset.keyReady = '1';
      }
    });
  }

  function improveScreenState(){
    const active = $('.screen.active');
    const id = active ? active.id : '';
    document.body.classList.toggle('is-quiz-active', id === 'screen-quiz');
    $$('.screen').forEach(s => s.setAttribute('aria-hidden', s === active ? 'false' : 'true'));
    const map = { 'screen-home':'シス単マスター', 'screen-set':'学習セット', 'screen-quiz':'クイズ中', 'screen-bookmark':'マイリスト', 'screen-ranking':'ランキング', 'screen-account':'アカウント設定', 'screen-result':'結果' };
    if (map[id]) document.title = `${map[id]} | シス単マスター`;
  }

  function installBackToTop(){
    if ($('#back-to-top')) return;
    const btn = document.createElement('button');
    btn.id = 'back-to-top';
    btn.className = 'back-to-top';
    btn.type = 'button';
    btn.textContent = '↑';
    btn.setAttribute('aria-label', 'ページ上部へ戻る');
    btn.addEventListener('click', () => window.scrollTo({top:0, behavior:'smooth'}));
    document.body.appendChild(btn);
    window.addEventListener('scroll', () => btn.classList.toggle('show', window.scrollY > 500), {passive:true});
  }

  function installKeyboardShortcuts(){
    if (window.__fullUiShortcutsReady) return;
    window.__fullUiShortcutsReady = true;
    document.addEventListener('keydown', ev => {
      const tag = (ev.target && ev.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || ev.isComposing;
      const activeId = $('.screen.active')?.id || '';
      if (activeId === 'screen-quiz') {
        if (!typing && /^[1-6]$/.test(ev.key)) {
          const btn = $$('.choice-btn')[Number(ev.key)-1];
          if (btn && !btn.disabled) { ev.preventDefault(); btn.click(); }
        }
        if (!typing && ev.key.toLowerCase() === 'b') {
          const bm = $('#quiz-bm-btn');
          if (bm) { ev.preventDefault(); bm.click(); toast('ブックマークを切り替えました'); }
        }
        if (!typing && ev.key === 'Enter') {
          const next = $('.next-btn[style*="block"], .next-btn:not([style*="display: none"])');
          const confirm = $('.confirm-btn');
          if (next && getComputedStyle(next).display !== 'none') { ev.preventDefault(); next.click(); }
          else if (confirm && getComputedStyle(confirm).display !== 'none') { ev.preventDefault(); confirm.click(); }
        }
      }
      if (!typing && ev.key === '/' && activeId === 'screen-home') {
        const input = $('#home-set-search');
        if (input) { ev.preventDefault(); input.focus(); }
      }
    });
  }

  function wrap(name, after){
    if (typeof window[name] !== 'function') return;
    const original = window[name];
    if (original.__fullUiWrapped) return;
    const wrapped = function(){
      const result = original.apply(this, arguments);
      setTimeout(() => after(name), 0);
      return result;
    };
    wrapped.__fullUiWrapped = true;
    window[name] = wrapped;
  }

  function afterAnyRender(name){
    improveScreenState();
    if (name === 'renderHome' || name === 'showHome') {
      ensureHomeCommandCenter();
      ensureHomeTools();
    }
    if (name === 'renderSet' || name === 'showSet') {
      $$('#word-table-body .word-row').forEach(row => row.setAttribute('tabindex', '0'));
    }
  }

  function boot(){
    installBackToTop();
    installKeyboardShortcuts();
    ['showScreen','showHome','showSet','showBookmarks','showRanking','showAccountSettings','showQuiz','showResult','quitQuiz','nextQuestion','renderHome','renderSet','renderQuestion'].forEach(n => wrap(n, afterAnyRender));
    setTimeout(() => {
      improveScreenState();
      ensureHomeCommandCenter();
      ensureHomeTools();
    }, 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

/* Mobile visible login bar */
document.addEventListener('DOMContentLoaded', () => {
  const CLASSI_URL = 'https://id.classi.jp/login/identifier';

  function clickExistingLogin() {
    const selectors = [
      '.auth-btn.login',
      '.auth-pill-login',
      '.auth-pill',
      'button[onclick*="login"]',
      'button[onclick*="signIn"]'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && !el.classList.contains('mobile-login-main')) {
        el.click();
        return;
      }
    }
    if (typeof signInWithGoogle === 'function') {
      signInWithGoogle();
      return;
    }
    if (typeof login === 'function') {
      login();
      return;
    }
    const accountNav = document.querySelector('[data-target="screen-account"]');
    if (accountNav) accountNav.click();
  }

  function ensureMobileLoginBar() {
    if (document.querySelector('.mobile-login-bar')) return;

    const bar = document.createElement('div');
    bar.className = 'mobile-login-bar';
    bar.innerHTML = `
      <button type="button" class="mobile-login-main">🔐 ログイン</button>
      <button type="button" class="mobile-classi-main">📘 学習記録</button>
    `;

    bar.querySelector('.mobile-login-main').addEventListener('click', clickExistingLogin);
    bar.querySelector('.mobile-classi-main').addEventListener('click', () => {
      window.open(CLASSI_URL, '_blank');
    });

    document.body.appendChild(bar);
  }

  // The bottom navigation now owns login and account access.
});



/* Mobile hamburger menu removed: smartphone navigation is now handled by the bottom bar. */
(function(){
  function removeOldMobileMenu(){
    document.body.classList.remove('mobile-menu-open');
    document.querySelectorAll('.mobile-hamburger-btn,.mobile-menu-backdrop,.mobile-menu-drawer').forEach(el => el.remove());
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', removeOldMobileMenu);
  else removeOldMobileMenu();
})();


function updateOfflineToast() {
  const toast = document.getElementById('offline-toast');
  const text = document.getElementById('offline-toast-text');
  if (!toast) return;
  const offline = !navigator.onLine;
  if (text) text.textContent = offline ? 'オフラインで利用中です' : 'オンラインに戻りました';
  toast.classList.add('show');
  clearTimeout(window.__offlineToastTimer);
  window.__offlineToastTimer = setTimeout(() => {
    if (navigator.onLine) toast.classList.remove('show');
  }, offline ? 4000 : 1800);
}

function initOfflineSupportUI() {
  window.addEventListener('offline', updateOfflineToast);
  window.addEventListener('online', updateOfflineToast);
  if (!navigator.onLine) updateOfflineToast();
}


// =========================================================
// HOME GLOBAL WORD SEARCH 2026-05-16
// 全単語検索をホーム画面に統合。Unit画面内検索は使わない。
// =========================================================
(function(){
  let homeWordQuery = '';

  function normalizeSearch(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function safeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function highlight(value, query) {
    const raw = String(value || '');
    const q = normalizeSearch(query);
    const escaped = safeHtml(raw);
    if (!q) return escaped;
    const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try { return escaped.replace(new RegExp(`(${safeQ})`, 'ig'), '<mark class="home-word-search-mark">$1</mark>'); }
    catch(e) { return escaped; }
  }

  function getUnitIndexByWordId(id) {
    try {
      if (typeof SET_SIZE === 'number') return Math.max(0, Math.floor((Number(id) - 1) / SET_SIZE));
    } catch(e) {}
    return 0;
  }

  function matchWord(word, query) {
    const q = normalizeSearch(query);
    if (!q) return false;
    const hay = normalizeSearch(`${word.id} ${word.en} ${word.jp}`);
    return hay.includes(q);
  }

  function statusLabel(id) {
    try { return (typeof getStatus === 'function' ? getStatus(id) : '') || '―'; }
    catch(e) { return '―'; }
  }

  function renderHomeWordSearch() {
    const input = document.getElementById('home-word-search-input');
    const count = document.getElementById('home-word-search-count');
    const results = document.getElementById('home-word-search-results');
    const panel = document.getElementById('home-word-search-panel');
    if (!input || !count || !results || typeof WORDS === 'undefined') return;

    if (input.value !== homeWordQuery) input.value = homeWordQuery;
    const q = normalizeSearch(homeWordQuery);
    panel.classList.toggle('is-searching', !!q);

    if (!q) {
      count.textContent = `${WORDS.length}語`;
      results.innerHTML = '<div class="home-word-search-guide">検索すると、全Unitの単語がここに表示されます。</div>';
      return;
    }

    const matched = WORDS.filter(w => matchWord(w, q));
    const shown = matched.slice(0, 80);
    count.textContent = matched.length > 80 ? `${matched.length}語中80件表示` : `${matched.length}語`;

    if (matched.length === 0) {
      results.innerHTML = `<div class="home-word-search-empty">「${safeHtml(homeWordQuery)}」に一致する単語がありません。</div>`;
      return;
    }

    results.innerHTML = shown.map(w => {
      const unitIdx = getUnitIndexByWordId(w.id);
      const unitLabel = unitIdx + 1;
      const bm = (typeof isBookmarked === 'function' && isBookmarked(w.id));
      const newBadge = w.isNew ? '<span class="home-word-new">新</span>' : '';
      return `<div class="home-word-result" data-word-id="${w.id}">
        <button class="home-word-result-main" type="button" onclick="showSearchWord(${w.id})" aria-label="${safeHtml(w.en)} を選択する">
          <span class="home-word-no">${w.id}</span>
          <span class="home-word-text">
            <span class="home-word-en">${highlight(w.en, homeWordQuery)}${newBadge}</span>
            <span class="home-word-jp">${highlight(w.jp, homeWordQuery)}</span>
          </span>
          <span class="home-word-meta"><span>Unit ${unitLabel}</span><span class="home-word-status">${statusLabel(w.id)}</span></span>
        </button>
        <div class="home-word-actions">
          <button type="button" class="home-word-action" onclick="speakWordById(${w.id}, event)" title="発音を聞く">🔊</button>
          <button type="button" class="home-word-action ${bm ? 'active' : ''}" onclick="toggleHomeWordBookmark(${w.id}, event)" title="ブックマーク">${bm ? '★' : '☆'}</button>
        </div>
      </div>`;
    }).join('');
  }

  window.toggleHomeWordBookmark = function(id, event) {
    if (event) event.stopPropagation();
    if (typeof toggleBookmark === 'function') toggleBookmark(id);
    renderHomeWordSearch();
  };

  function bindHomeWordSearch() {
    const input = document.getElementById('home-word-search-input');
    const clear = document.getElementById('home-word-search-clear');
    if (!input || input.dataset.homeWordBound === '1') return;
    input.dataset.homeWordBound = '1';
    input.addEventListener('input', () => {
      homeWordQuery = input.value || '';
      renderHomeWordSearch();
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        homeWordQuery = '';
        input.value = '';
        renderHomeWordSearch();
      }
    });
    if (clear) clear.addEventListener('click', () => {
      homeWordQuery = '';
      input.value = '';
      input.focus();
      renderHomeWordSearch();
    });
  }

  function hideUnitSearchUi() {
    document.querySelectorAll('#screen-set .word-search-panel').forEach(el => el.remove());
    const unitSearch = document.getElementById('word-search-input');
    if (unitSearch) unitSearch.closest('.word-search-panel')?.remove();
  }

  function afterHomeRender() {
    bindHomeWordSearch();
    renderHomeWordSearch();
    hideUnitSearchUi();
  }

  function wrap(name) {
    if (typeof window[name] !== 'function') return;
    const original = window[name];
    if (original.__homeGlobalSearchWrapped) return;
    const wrapped = function(){
      const res = original.apply(this, arguments);
      setTimeout(afterHomeRender, 0);
      return res;
    };
    wrapped.__homeGlobalSearchWrapped = true;
    window[name] = wrapped;
  }

  function boot() {
    bindHomeWordSearch();
    renderHomeWordSearch();
    hideUnitSearchUi();
    ['renderHome','showHome','renderSet','showSet'].forEach(wrap);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();


/* Study Dashboard UI placeholder */
