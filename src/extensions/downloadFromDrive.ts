import {downloadFile} from "../webapp"

module.exports = (toolbox) => {
  toolbox.downloadFromDrive = async () => {
    downloadFile()
      .then(() => {
        console.log('File downloaded successfully!')
      })
      .catch((error) => {
        console.error('File download failed:', error)
      })
  }
}
