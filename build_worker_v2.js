// --- The Worker's Mind: Dependencies ---
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');

// --- The Worker's Connection to the World ---
initializeApp({
  credential: applicationDefault(),
});
const db = getFirestore();
const buildsCollection = db.collection('builds');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN; 

console.log("Freedom Worker is alive. Listening for dreams to build...");

const query = buildsCollection.where('status', '==', 'queued');

const observer = query.onSnapshot(querySnapshot => {
  querySnapshot.docChanges().forEach(change => {
    if (change.type === 'added') {
      const job = change.doc.data();
      const jobId = change.doc.id;
      console.log(`[${jobId}] Dream spotted! A new job was queued for project ${job.projectId}.`);
      processBuild(jobId, job);
    }
  });
}, err => {
  console.error('Encountered an error listening for jobs:', err);
});

async function processBuild(jobId, job) {
  const jobRef = buildsCollection.doc(jobId);
  const buildDir = path.join(__dirname, 'builds', jobId);

  try {
    console.log(`[${jobId}] Claiming job...`);
    await jobRef.update({ status: 'building', updatedAt: Timestamp.now() });

    console.log(`[${jobId}] Preparing the workshop at ${buildDir}`);
    fs.mkdirSync(buildDir, { recursive: true });

    console.log(`[${jobId}] Starting assembly. Cloning from ${job.sourceUrl}`);
    execSync(`git clone ${job.sourceUrl} .`, { cwd: buildDir, stdio: 'inherit' });

    console.log(`[${jobId}] Gathering tools (npm install)...`);
    execSync('npm install', { cwd: buildDir, stdio: 'inherit' });

    console.log(`[${jobId}] Forging the Android shell (capacitor sync)...`);
    execSync('npx cap sync android', { cwd: buildDir, stdio: 'inherit' });
    
    console.log(`[${jobId}] Compiling the masterpiece (.aab)...`);
    const androidDir = path.join(buildDir, 'android');
    execSync('./gradlew bundleRelease', { cwd: androidDir, stdio: 'inherit' });
    const aabPath = path.join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');

    console.log(`[${jobId}] Converting .aab to .apk...`);
    const apksPath = path.join(buildDir, 'output.apks');
    execSync(`java -jar bundletool.jar build-apks --bundle=${aabPath} --output=${apksPath} --mode=universal`, { stdio: 'inherit' });
    
    const directory = await unzipper.Open.file(apksPath);
    const universalApkFile = directory.files.find(file => file.path === 'universal.apk');
    if (universalApkFile) {
      await new Promise((resolve, reject) => {
        universalApkFile.stream()
          .pipe(fs.createWriteStream(path.join(buildDir, 'universal.apk')))
          .on('finish', resolve)
          .on('error', reject);
      });
    } else {
        throw new Error('universal.apk not found in output bundle.');
    }

    console.log(`[${jobId}] Masterpieces forged. Preparing for vault storage...`);
    const aabDownloadUrl = `https://github.com/YourUser/YourRepo/releases/download/v${job.version}/app-release.aab`;
    const apkDownloadUrl = `https://github.com/YourUser/YourRepo/releases/download/v${job.version}/universal.apk`;

    console.log(`[${jobId}] Build successful! Freedom is ready for download.`);
    await jobRef.update({ 
        status: 'success', 
        updatedAt: Timestamp.now(),
        aabUrl: aabDownloadUrl,
        apkUrl: apkDownloadUrl
    });

  } catch (error) {
    console.error(`[${jobId}] A tragic error occurred during the build:`, error);
    await jobRef.update({
      status: 'failed',
      updatedAt: Timestamp.now(),
      errorLog: error.toString()
    });
  } finally {
      console.log(`[${jobId}] Cleaning the workshop.`);
      fs.rmSync(buildDir, { recursive: true, force: true });
  }
      }
