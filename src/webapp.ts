const axios = require('axios')
const fs = require('fs-extra')
const path = require('path')
const XLSX = require('xlsx')
const ejs = require('ejs')
const _ = require('lodash')
const os = require('os')
const types = require('../config/types.json')
const simpleGit = require('simple-git')
const AdmZip = require('adm-zip')
import { to } from 'await-to-js'

require('dotenv').config()

/**
 * Checks if the GOOGLE_SHEET_ID environment variable is present or not.
 * If the GOOGLE_SHEET_ID is missing, it throws an error indicating the absence of the ID.
 * It also verifies the existence of the '.env' file and throws an error if it is missing.
 *
 * @throws {Error} If the '.env' file is missing or if GOOGLE_SHEET_ID is not found in the '.env' file.
 */
const checkSheetId = () => {
  require('dotenv').config()
  if (!process.env.GOOGLE_SHEET_ID) {
    if (!fs.existsSync('.env')) {
      throw `.env file is missing`
    }
    // check if .env file is missing
    else throw `GOOGLE_SHEET_ID is missing in .env file`
  }
}

/**
 * Downloads a file from a Google Spreadsheet based on the provided GOOGLE_SHEET_ID environment variable.
 * The file is exported in xlsx format and saved locally in the 'data' directory as 'imported_sheet.xlsx'.
 *
 * @returns {Promise<void>} A Promise that resolves when the file download and save operation completes successfully.
 * @throws {Error} If there's an error during the file download or saving process.
 */
const downloadFile = async () => {
  checkSheetId()
  const spreadsheetId = process.env.GOOGLE_SHEET_ID
  const fileUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`
  try {
    const response = await axios({
      method: 'GET',
      url: fileUrl,
      responseType: 'stream',
    })

    // const directory = path.join(require('os').homedir(), 'webappbot');
    const directory = 'data'
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory)
    }
    const fileName = 'imported_sheet.xlsx'
    const filePath = path.join(process.cwd(), directory, fileName)
    const writer = fs.createWriteStream(filePath)
    response.data.pipe(writer)
    return new Promise((resolve, reject) => {
      writer.on('finish', resolve)
      writer.on('error', reject)
    })
  } catch (error) {
    console.error('Error downloading file:', error)
  }
}

/**
 * Initiates the process to download a file from Google Drive and convert it to JSON format.
 * It internally calls asynchronous functions to download the file and convert it to JSON.
 *
 * @returns {Promise<boolean>} A Promise that resolves to 'true' upon successful completion of file download and conversion to JSON.
 * @throws {Error} If there's an error during the download or conversion process.
 */
const downloadFromDriveAndConvertToJson = async () => {
  return new Promise(async (resolve, reject) => {
    await downloadFile()
    await xlsxToJSON()
    resolve(true)
  })
}

/**
 * Identifies and returns an array of sheet names that contain 'Model' as the value of cell A1
 *
 * @param {Object} workbook - The workbook object containing sheet data.
 * @returns {Array<string>} An array of sheet names containing a 'Model' as the first field.
 */
const getSheetsHavingModels = (workbook) => {
  let sheetsHavingModels = []
  // value of cell A1 should be 'Model' for it the sheet to be evaluated
  ;(workbook.SheetNames || []).map((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json(sheet)
    let firstFieldName = Object.keys(data[0] || {})[0]
    if (firstFieldName === 'Model') sheetsHavingModels.push(sheetName)
  })
  return sheetsHavingModels
}

/**
 * Extracts and organizes data related to models and partials from the provided workbook.
 *
 * @param {Object} workbook - The workbook object containing sheet data.
 * @returns {Object} An object containing two properties: 'modelsData' and 'partials',
 *                    representing organized model data and partials extracted from the workbook.
 */
const getModelsDataAndPartialsFromWorkbook = (workbook) => {
  let modelsData = {},
    partials = {},
    modelKey = ''
  let sheetsHavingModels = getSheetsHavingModels(workbook)
  sheetsHavingModels.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json(sheet)
    data.map((item) => {
      let { Model, Field } = item
      if (Model) {
        modelKey = Model
        if (sheetName === 'partials') partials[modelKey] = {}
        else {
          if (modelsData[sheetName] === undefined) modelsData[sheetName] = {}
          modelsData[sheetName][modelKey] = {}
        }
      }
      // else {
      // remove model from item
      delete item.Model
      if (sheetName === 'partials') partials[modelKey][Field] = item
      else {
        modelsData[sheetName][modelKey][Field] = item // where if modelKey being set?
      }
      // }
    })
  })
  return { modelsData, partials }
}

/**
 * Fills partials within model data by replacing partials field references with actual partials model data.
 *
 * @param {Object} modelsData - An object containing organized model data.
 * @param {Object} partials - An object containing partials-related data.
 */
const fillPartials = (modelsData, partials) => {
  // partials
  // replace partials field in model with partials model
  // eg. if Field=partials.Base, replace the text "partials.Base" with Base model of partials
  for (let sheetName in modelsData) {
    let modelsData_ = modelsData[sheetName]
    for (let modelName in modelsData_) {
      let model = modelsData_[modelName]
      let retModel = {}
      for (let key in model) {
        if (!key.match(/^partials\./)) retModel[key] = model[key]
        else {
          let partialsData = partials[key.replace(/partials\./, '')]
          Object.keys(partialsData).map((partialKey) => {
            retModel[partialKey] = partialsData[partialKey]
          })
        }
      }
      modelsData_[modelName] = retModel
    }
    modelsData[sheetName] = modelsData_
  }
}
/**
 * Replaces webappbot types in model data with corresponding model types.
 *
 * @param {Object} modelsData - An object containing models data.
 */
const replaceWebAppTypesWithModelType = (modelsData) => {
  // types
  for (let packageName in modelsData) {
    let packageData = modelsData[packageName]
    for (let modelName in packageData) {
      let modelData = packageData[modelName]
      for (let field in modelData) {
        let { Type } = modelData[field]
        if (Type) {
          Type = Type.toLowerCase()
          let typeFromTypes = types[Type]
          if (typeFromTypes) {
            modelData[field]['typeFromTypes'] = typeFromTypes
          }
        }
      }
      packageData[modelName] = modelData
    }
    modelsData[packageName] = packageData
  }
}

/**
 * Segregates API sections within the models' data.
 *
 * @param {Object} modelsData - Data containing models grouped by package name.
 * @returns {Object} Modified models data with segregated API sections.
 */
const segregateAPISections = (modelsData) => {
  // types
  for (let packageName in modelsData) {
    let packageData = modelsData[packageName]
    for (let modelName in packageData) {
      let modelData = packageData[modelName]

      for (let field in modelData) {
        let apiData = {}
        let keys = Object.keys(modelData[field])
        keys.map((key) => {
          let bby = modelData[field][key]
          if (
            ['create', 'read', 'update', 'delete'].includes(
              key.toLocaleLowerCase()
            ) &&
            ['required', 'optional'].includes(bby.toLocaleLowerCase())
          ) {
            delete modelData[field][key]
            apiData[key.toLocaleLowerCase()] = bby.toLocaleLowerCase()
          }
        })
        if (Object.keys(apiData).length > 0) {
          modelData[field]['api'] = apiData
        }
      }

      packageData[modelName] = modelData
    }
    modelsData[packageName] = packageData
  }
}

const processRoutesDataFromModelsData = (routesData) => {
  let reorganized = {}
  for (let packageName in routesData) {
    reorganized[packageName] = reorganized[packageName] || {}
    let packageData = routesData[packageName]
    for (let modelName in packageData) {
      reorganized[packageName][modelName] = reorganized[packageName][
        modelName
      ] || { create: [], read: [], update: [], delete: [] }
      let modelData = packageData[modelName]

      for (let field in modelData) {
        let keys = Object.keys(modelData[field])
        keys.map((key) => {
          if (key !== 'api') delete modelData[field][key]
        })
        if (Object.keys(modelData[field]).length === 0) delete modelData[field]
      }
      ;['create', 'read', 'update', 'delete'].map((action) => {
        console.log(action)
        reorganized[packageName][modelName][action] = Object.keys(
          modelData
        ).filter((field) => {
          return Object.keys(modelData[field]['api']).includes(action)
        })
        if (
          Object.keys(reorganized[packageName][modelName][action]).length == 0
        )
          delete reorganized[packageName][modelName][action]
      })
    }
  }
  Object.assign(routesData, reorganized)
  return routesData
}
/**
 * Converts data from an Excel file (in xlsx format) to a JSON structure based on specific sheet structures.
 * It extracts information from the imported Excel file, organizes it according to predefined structures,
 * and writes the resulting JSON data to a 'models.json' file in the 'data' directory.
 *
 * @returns {Promise<boolean>} A Promise that resolves to 'true' upon successful completion of the conversion to JSON and writing to the file.
 * @throws {Error} If there's an error during the conversion process or file writing.
 */
const xlsxToJSON = async () => {
  return new Promise(async (resolve, reject) => {
    const dataDirectory = 'data'
    const xlsxFileName = 'imported_sheet.xlsx'
    const xlsxFilePath = path.join(process.cwd(), dataDirectory, xlsxFileName)
    const workbook = XLSX.readFile(xlsxFilePath)
    const modelsFileName = 'models.json'
    const modelsFilePath = path.join(
      process.cwd(),
      dataDirectory,
      modelsFileName
    )
    const routesFilePath = path.join(
      process.cwd(),
      dataDirectory,
      'routesFromModels.json'
    )

    let { modelsData, partials } =
      getModelsDataAndPartialsFromWorkbook(workbook)
    fillPartials(modelsData, partials)
    replaceWebAppTypesWithModelType(modelsData)
    // api
    segregateAPISections(modelsData)
    let routesData = Object.assign({}, modelsData)
    processRoutesDataFromModelsData(routesData)

    const jsonString = JSON.stringify(modelsData, null, 2) // null and 2 for pretty formatting
    const jsonStringRoutes = JSON.stringify(routesData, null, 2) // null and 2 for pretty formatting
    console.log(routesData)

    // Write JSON string to a file
    try {
      fs.writeFileSync(modelsFilePath, jsonString)
      fs.writeFileSync(routesFilePath, jsonStringRoutes)
      console.log('JSON data has been saved to', modelsFilePath)
    } catch (err) {
      console.error('Error writing file:', err)
    }
    resolve(true)
  })
}

/**
 * Reads the content of a specific template file.
 *
 * @param {string} template - The name of the template file (without extension) to be read.
 * @returns {string} The content of the specified template file in UTF-8 encoding.
 */
const readTemplateData = (template) => {
  const templateDirectory = 'templates'
  const templateFileName = `${template}.ejs`
  const templateFilePath = path.join(
    process.cwd(),
    templateDirectory,
    templateFileName
  )
  return fs.readFileSync(templateFilePath, 'utf8')
}

/**
 * Reads and retrieves JSON data from the 'models.json' file located in the 'data' directory.
 *
 * @returns {object} An object containing the JSON data retrieved from the 'models.json' file.
 * @throws {Error} If there's an error while reading or parsing the 'models.json' file.
 */
const readModelsData = (jsonFilePath = '') => {
  const jsonPath = path.join(
    process.cwd(),
    'data',
    jsonFilePath == '' ? 'models.json' : jsonFilePath
  )
  const modelsData = require(jsonPath)
  return modelsData
}

/**
 * Creates directories for models based on the keys obtained from model data.
 */
const createModelsDirectories = () => {
  let modelsData = readModelsData()
  for (const package_ of Object.keys(modelsData)) {
    let modelDir = path.join(process.cwd(), 'local-src', 'models', package_)
    if (!fs.existsSync(modelDir)) {
      // fs.mkdirSync(modelDir)
      fs.mkdirSync(modelDir, { recursive: true })
    } else {
      fs.removeSync(modelDir)
      // fs.mkdirSync(modelDir)
      fs.mkdirSync(modelDir, { recursive: true })
    }
  }
}
/**
 * Creates directories for routes
 */
const createRoutesDirectories = () => {
  let routesDir = path.join(process.cwd(), 'local-src', 'systemRoutes')
  if (!fs.existsSync(routesDir)) {
    // fs.mkdirSync(modelDir)
    fs.mkdirSync(routesDir, { recursive: true })
  } else {
    fs.removeSync(routesDir)
    // fs.mkdirSync(modelDir)
    fs.mkdirSync(routesDir, { recursive: true })
  }
  let routeGlobalsTemplateContent = readTemplateData('routeGlobals')
  let routeGlobalsFile = path.join(routesDir, `globals_.go`)
  fs.writeFileSync(routeGlobalsFile, routeGlobalsTemplateContent, (err) => {
    if (err) {
      console.error('Error writing file:', err)
    }
  })
}
/**
 * Creates directories for controllers based on the keys obtained from model data.
 */
const createControllersDirectories = () => {
  let modelsData = readModelsData('routesFromModels.json')
  let globalTemplateContentPersistent = readTemplateData(
    'globalPersistentController'
  )
  for (const package_ of Object.keys(modelsData)) {
    let modelDir = path.join(
      process.cwd(),
      'local-src',
      'controllers',
      package_
    )
    let persistentControllerDir = path.join(
      process.cwd(),
      'local-src',
      'persistent-controllers',
      package_
    )
    if (!fs.existsSync(modelDir)) {
      fs.mkdirSync(modelDir, { recursive: true })
    } else {
      fs.removeSync(modelDir)
      fs.mkdirSync(modelDir, { recursive: true })
    }
    if (!fs.existsSync(persistentControllerDir)) {
      fs.mkdirSync(persistentControllerDir, { recursive: true })
    } // do not interefere with existing persistent controllers

    // global file for persistent controllers
    let packageCamelCase = _.camelCase(package_)
    let packageTitleCase =
      packageCamelCase[0].toUpperCase() +
      packageCamelCase.slice(-(packageCamelCase.length - 1))
    let renderized = ejs.render(globalTemplateContentPersistent, {
      package: packageCamelCase,
      packageTitleCase,
    })
    
    let controllerFile = path.join(persistentControllerDir, `global.go`)
      fs.writeFileSync(controllerFile, renderized, (err) => {
        if (err) {
          console.error('Error writing file:', err)
        }
      })
  }
}
/**
 * Reads the module path from the first line of the 'go.mod' file.
 *
 * @returns {string} The module path extracted from the first line of the 'go.mod' file or an empty string if the file cannot be read or no module path is found.
 */
const readModulePath = () => {
  // Function to read the first line of a file
  function readFirstLine(filePath) {
    try {
      const data = fs.readFileSync(filePath, 'utf8')
      const firstLine = data.split('\n')[0] // Extract the first line
      return firstLine
    } catch (err) {
      console.error('Error reading file:', err)
      return null
    }
  }

  function removeModuleStrAndSpaces(line) {
    const moduleNameRemoved = line.replace(/^[^ ]+\s+/, '') // Removes the first word and spaces
    return moduleNameRemoved
  }

  const filePath = './go.mod'
  const firstLine = readFirstLine(filePath)
  if (firstLine) {
    const result = removeModuleStrAndSpaces(firstLine)
    return result
  }
  return ''
}
/**
 * Processes model data and generates Go language files based on templates and model definitions.
 * Reads templates and model data, creates directories, and generates Go language files for each model.
 */
const processModels = async () => {
  /**
   * Lists model packages and their import strings based on available data in 'modelsData' and the 'go.mod' file.
   *
   * @returns {Array} An array containing import strings for model packages as per the 'modelsData' and 'go.mod' file.
   */
  const listModelPackages = () => {
    let modelImportStrs = []
    let modelsData = readModelsData()
    let modulePath = readModulePath()
    for (const package_ of Object.keys(modelsData)) {
      let modelStr = `${package_}Models "${modulePath}/src/models/${package_.toLowerCase()}"`
      if (!modelImportStrs.includes(modelStr)) modelImportStrs.push(modelStr)
    }
    modelImportStrs.unshift(`"${modulePath}/config"`)
    return modelImportStrs
  }

  /**
   * Creates variables based on the provided field object.
   *
   * @param {Object} field - The field object containing type information.
   * @returns {Object} An object containing variables derived from the provided field object:
   *                    - 'field': The original field object.
   *                    - 'type': The inferred or transformed type based on 'typeFromTypes' or 'Type' in the field object.
   *                    - 'typeFromTypes': The retrieved 'typeFromTypes' value from the field object.
   */
  const createFieldVariables = (field) => {
    //type
    let { typeFromTypes, Type } = field
    let type = Type

    if (typeFromTypes) {
      if (typeof typeFromTypes === 'object') {
        type = typeFromTypes.type
        if (typeFromTypes.length) {
          field.length = typeFromTypes.length
        }
      } else {
        type = typeFromTypes
      }
    }
    return { field, type, typeFromTypes }
  }

  /**
   * Adds import statements to an array based on the provided type and import mapping.
   *
   * @param {string} type - The type for which an import statement needs to be added.
   * @param {Array} imports - An array containing existing import statements.
   */
  const addToImports = (type, imports, importStrType = '') => {
    let importStringsMaps = {
      'uuid.UUID': `uuid "github.com/google/uuid"`,
      'time.Time': `"time"`,
    }
    switch (importStrType) {
      case '':
        if (!Object.keys(importStringsMaps).includes(type)) return
        if (!imports.includes(importStringsMaps[type]))
          imports.push(importStringsMaps[type])
        break
      case 'local':
        if (!imports.includes(type)) imports.push(type)
    }
  }

  /**
   * Sets the primary key field and manages necessary imports based on field properties.
   *
   * @param {string} primary - The current primary key field.
   * @param {string} fieldKey - The key representing the field.
   * @param {Object} field - The field object containing properties, including 'Primary'.
   * @param {Array} imports - An array containing existing import statements.
   */
  const setPrimarykey = (primary, fieldKey, field, imports) => {
    if (field.Primary) {
      primary = fieldKey
    } else {
      addToImports('uuid.UUID', imports) // default pk type is UUID
    }
  }

  /**
   * Sets the default value for a field based on its properties.
   *
   * @param {Object} field - The field object
   */
  const setDefaultValue = (field) => {
    let { DefaultValue, typeFromTypes } = field
    if (DefaultValue !== undefined) {
      switch (typeFromTypes) {
        case 'string':
          DefaultValue = `'${DefaultValue}'`
          break
        case 'bool':
          break
        default:
      }
      field.DefaultValue = DefaultValue
    }
  }

  /**
   * Sets the length property for a field based on its properties.
   *
   * @param {Object} field - The field object
   */
  const setFieldLength = (field) => {
    let { length, MaximumLength } = field
    if (MaximumLength !== undefined) {
      field.Length = MaximumLength
    }
    if (length !== undefined) {
      field.Length = length
    }
  }

  /**
   * Handles setting properties related to 'time.Time' type for a field object.
   *
   * @param {Object} field - The field object
   */
  const setTimeType = (field) => {
    if (field.typeFromTypes === 'time.Time') {
      let { NotNull, AutoCreate } = field
      if (!NotNull) {
        field.type = '*time.Time'
      }
      if (AutoCreate) {
        field.misc = 'autoCreateTime'
      }
    }
  }

  /**
   * Handles setting properties related to 'int' type for a field object.
   *
   * @param {Object} field - The field object
   */
  const setIntType = (field) => {
    if (field.typeFromTypes === 'int') {
      let { Minimum, Maximum } = field
      if (Minimum !== undefined) {
        if (Maximum === undefined) Maximum = 18446744073709551615
      }
      if (Maximum !== undefined) if (Minimum === undefined) Minimum = -1
      if (Maximum === undefined && Minimum === undefined) field.type = 'int64'
      else {
        if (Minimum >= 0 && Maximum <= 4294967295) {
          field.type = 'uint32'
        } else if (Minimum >= 0 && Maximum > 4294967295) {
          field.type = 'uint64'
        } else if (Minimum < 0 && Maximum <= 2147483647) {
          field.type = 'int32'
        } else if (Minimum < 0 && Maximum > 2147483647) {
          field.type = 'int64'
        }
      }
    }
  }

  /**
   * Handles setting properties related to 'float' type for a field object.
   *
   * @param {Object} field - The field object
   */
  const setFloatType = (field) => {
    if (field.typeFromTypes === 'float') {
      let { Maximum } = field
      if (Maximum === undefined) field.type = 'float64'
      else {
        if (Math.abs(Maximum) <= 3.402823466e385) {
          field.type = 'float32'
        } else if (Math.abs(Maximum) <= 1.7976931348623157e308) {
          field.type = 'float64'
        }
      }
    }
  }

  /**
   * Sets the default field type and length based on the 'typeFromTypes' property in the field object.
   *
   * @param {Object} field - The field object.
   */
  const setDefaultFieldType = (field) => {
    let { typeFromTypes } = field
    if (typeof typeFromTypes === 'object') {
      let { type, length } = typeFromTypes
      if (type) field.type = type
      if (length) field.Length = length
    } else field.type = typeFromTypes
  }

  /**
   * Generates the local model package import string based on the provided package name and 'go.mod' file data.
   *
   * @param {string} packageName - The name of the package for which the import string is generated.
   * @returns {string} The import string for the specified package, formatted as per the 'go.mod' file and package name.
   */
  const getLocalModelPackageStr = (packageName) => {
    let modulePath = readModulePath()
    return `${packageName} "${modulePath}/src/models/${packageName.toLowerCase()}"`
  }

  /**
   * Creates relationships in the 'fields' object based on the specified 'fieldKey'.
   *
   * @param {Object} fields - The object containing fields.
   * @param {string} fieldKey - The key representing the field.
   */
  const createRelationShips = (fields, fieldKey, packageCamelCase, imports) => {
    let field = fields[fieldKey]
    if (fieldKey.match(/\./)) {
      let fieldNameParts = fieldKey.split('.')
      let relatedModelPackage = fieldNameParts[0]
      let relatedModel = fieldNameParts[1]
      let relatedFieldName = fieldNameParts[1] + 'Id'
      let relatedModelType = relatedModel
      if (relatedModelPackage !== packageCamelCase) {
        relatedModelType = fieldKey
        let importStr = getLocalModelPackageStr(relatedModelPackage)
        addToImports(importStr, imports, 'local')
      }
      // delete fields[fieldKey]
      fields[relatedModel] = {
        typeFromTypes: relatedModelType,
        misc: `constraint:OnDelete:CASCADE;`,
      }
      fields[relatedFieldName] = field
      fields[relatedFieldName].typeFromTypes = 'uuid.UUID'
    }
  }

  /**
   * Updates the 'fields' object by either adding or deleting a field based on the 'fieldKey'.
   * If the 'fieldKey' does not contain a dot ('.'), the 'fields' object is updated with the provided 'field'.
   * If the 'fieldKey' contains a dot ('.'), it assigns the 'parentModel' and removes the corresponding field from 'fields'.
   *
   * @param {Object} fields - The object containing fields.
   * @param {Object} field - The field object to be added.
   * @param {string} fieldKey - The key representing the field.
   * @param {string} parentModel - The key of the parent model.
   */
  const updateField = (fields, field, fieldKey, parentModel) => {
    if (!fieldKey.match(/\./)) fields[fieldKey] = field
    else {
      parentModel.value = fieldKey
      delete fields[fieldKey]
    }
  }

  /**
   * Sorts models based on their hierarchy data and dependencies.
   *
   * @param {string[]} allModelStrs - Array of all model strings.
   * @param {Object} allModelsWithHierarchyData - Object containing model hierarchy data.
   * @returns {string[]} The sorted array of models based on their hierarchy and dependencies.
   */
  const sortModelsByHierarchy = (allModelStrs, allModelsWithHierarchyData) => {
    const sortedModels = []

    allModelStrs.map((model) => {
      // only parents
      let isChild = false
      Object.values(allModelsWithHierarchyData).map((item: any) => {
        if (item.includes(model.replace(/Models\./, '.'))) isChild = true
      })
      if (!isChild) sortedModels.push(model)
    })

    for (let i = 0; i <= 5; i++) {
      // children in only one group if parent already exists
      allModelStrs.map((model) => {
        // only parents
        let numParents = 0
        let parent = ''
        Object.values(allModelsWithHierarchyData).map((item: any, index) => {
          if (item.includes(model.replace(/Models\./, '.'))) {
            numParents++
            parent = Object.keys(allModelsWithHierarchyData)[index]
          }
        })
        if (numParents == 1) {
          if (sortedModels.includes(parent.replace(/\./, `Models.`))) {
            if (!sortedModels.includes(model)) sortedModels.push(model)
          }
        }
      })
    }
    // all the rest of the children. Fix on case by case basis upon failure
    allModelStrs.map((model) => {
      if (!sortedModels.includes(model)) sortedModels.push(model)
    })

    return sortedModels
  }

  let templateContent = readTemplateData('models')
  let modelsData = readModelsData()
  createModelsDirectories()
  let allModelStrs = []
  let allModelsWithHierarchyData = {}
  for (const package_ of Object.keys(modelsData)) {
    let { packageCamelCase, modelDir, packageData } = createPackageVariables(
      modelsData,
      package_
    )
    for (const model of Object.keys(packageData)) {
      let { imports, modelCamelCase, fields, primary } =
        createPackageDataVariables(model, packageData)
      // let parentModel: any = false
      let parentModel: any = { value: false }
      for (let fieldKey in fields) {
        let { field /*type /*, typeFromTypes */ } = createFieldVariables(
          fields[fieldKey]
        )
        createRelationShips(fields, fieldKey, packageCamelCase, imports)
        updateField(fields, field, fieldKey, parentModel)
      }
      // parentModel.value = false
      for (let fieldKey in fields) {
        let { field, type /*, typeFromTypes */ } = createFieldVariables(
          fields[fieldKey]
        )
        addToImports(type, imports)
        setDefaultFieldType(field)
        setPrimarykey(primary, fieldKey, field, imports)
        setDefaultValue(field)
        setFieldLength(field)
        setTimeType(field)
        setIntType(field)
        setFloatType(field)
        updateField(fields, field, fieldKey, parentModel)
      }
      if (parentModel.value) {
        let model_ = `${packageCamelCase}.${model}`
        if (allModelsWithHierarchyData[parentModel.value] === undefined) {
          allModelsWithHierarchyData[parentModel.value] = [model_]
        } else {
          allModelsWithHierarchyData[parentModel.value].push(model_)
        }
      }

      // console.log({ packageCamelCase, model , parentModel:parentModel})
      allModelStrs.push(`${packageCamelCase}Models.${model}`)
      let renderized = ejs.render(templateContent, {
        package: packageCamelCase,
        modelCamelCase,
        modelTitleCase: model,
        fields,
        Primary: primary,
        imports,
      })
      // correct modelFile name
      // console.log(renderized)

      let modelFile = path.join(modelDir, `${modelCamelCase}.go`)
      fs.writeFileSync(modelFile, renderized, (err) => {
        if (err) {
          console.error('Error writing file:', err)
        } else {
          console.log('JSON data has been saved to', modelFile)
        }
      })
    }
  }

  // db.go
  {
    allModelStrs = allModelStrs.reverse()
    console.log(allModelStrs)
    const sortedModels = sortModelsByHierarchy(
      allModelStrs,
      allModelsWithHierarchyData
    )
    console.log({ sortedModels })
    console.log({ allModelsWithHierarchyData, allModelStrs })
    let modelPackages = listModelPackages()
    templateContent = readTemplateData('db.go')
    let renderized = ejs.render(templateContent, {
      imports: modelPackages,
      allModelStrs,
    })
    const directory = path.join(process.cwd(), 'local-src', 'db')
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory)
    }
    let dbFile = path.join(directory, `db.go`)
    fs.writeFileSync(dbFile, renderized, (err) => {
      if (err) {
        console.error('Error writing file:', err)
      } else {
        console.log('JSON data has been saved to', dbFile)
      }
    })
  }
  // console.log({ types })
}

/**
 * Finds and extracts the value assigned to 'cfgFileName' from the './config/config.go' file.
 *
 * @returns {string} The value assigned to 'cfgFileName'.
 * @throws Throws an error if 'cfgFileName' is not found in the file.
 */
const findLinesStartingWithCfgFileName = () => {
  const filePath = './config/config.go'
  const fileContent = fs.readFileSync(filePath, 'utf8')
  const lines = fileContent.split('\n')

  for (let line of lines) {
    if (line.trim().startsWith('cfgFileName = ')) {
      line = line
        .replace(/^[ \t]*cfgFileName[ \t]*=[ \t]*/, '')
        .replace(/"/g, '')
        .replace(/[ \t]*$/, '')
      return line
    }
  }
  throw 'cfgFileName not found'
}

/**
 * Renames the module path by replacing occurrences of the current module path with a new name in files within the current directory.
 *
 * @param {string} newName - The new name to replace the current module path.
 */
const renameModulePath = (newName) => {
  let modulePath = readModulePath()
  const directoryPath = './'
  const targetString = modulePath
  const replacementString = newName
  replaceStringInFiles(directoryPath, targetString, replacementString)
}

/**
 * Recursively replaces a specified target string with a replacement string in files within the given directory path.
 *
 * @param {string} dirPath - The path of the directory to search for files.
 * @param {string} target - The string to be replaced.
 * @param {string} replacement - The string to replace occurrences of the target.
 * @param {boolean} wholeWord - Optional. Determines if replacement should match whole word. Defaults to false.
 */
const replaceStringInFiles = (
  dirPath,
  target,
  replacement,
  wholeWord = false
) => {
  const files = fs.readdirSync(dirPath)

  files.forEach((file) => {
    if (file !== '.git') {
      // Skip processing the .git directory
      const filePath = path.join(dirPath, file)
      if (fs.statSync(filePath).isDirectory()) {
        // Recursively traverse directories
        replaceStringInFiles(filePath, target, replacement)
      } else {
        // Read file content
        let fileContent = fs.readFileSync(filePath, 'utf8')
        // Replace target string with replacement string
        const replacedContent = fileContent.replace(
          wholeWord
            ? new RegExp(`\\b${target}\\b`, 'g')
            : new RegExp(target, 'g'),
          replacement
        )
        // Write modified content back to file
        fs.writeFileSync(filePath, replacedContent, 'utf8')
      }
    }
  })
}

/**
 * Renames the module throughout the codebase and related files with the provided new name.
 *
 * @param {string} newName - The new name for the module.
 */
const renameModuleName = (newName) => {
  let moduleName = findLinesStartingWithCfgFileName()
  const directoryPath = process.cwd()
  const targetString = moduleName
  const replacementString = newName
  replaceStringInFiles(directoryPath, targetString, replacementString, true)
  replaceStringInFiles(
    directoryPath,
    `${targetString}_`,
    `${replacementString}_`,
    false
  )
  renameEtcFiles(moduleName, newName)
}

/**
 * Renames either a module path or an application based on the provided type and new name.
 *
 * @param {Object} args - The arguments object containing the 'type' property.
 * @param {Object} supplied - The supplied object containing the '-n' property with the new name.
 * @returns {Promise<void>} A Promise resolving after the renaming process based on the specified type and new name.
 */
const rename = async (args, supplied) => {
  let newName = supplied['-n']
  let { type } = args
  switch (type) {
    case 'module':
      {
        renameModulePath(newName)
      }
      break
    case 'app':
      {
        renameModuleName(newName)
      }
      break
  }
}

/**
 * Creates a new backend application using the specified name by downloading and extracting the backend boilerplate from a GitHub repository.
 *
 * @param {string} name - The name of the new backend application to be created.
 * @returns {Promise<void>} A Promise that resolves after the backend boilerplate is downloaded and extracted.
 */
const createNewBackendApp = async (name) => {
  name = name.replace(/[ \t]*/g, '')
  await downloadAndUnzipFromGithub(name)
}

/**
 * Downloads a file from the specified URL, expecting a zip file, and extracts its contents to the specified output directory.
 *
 * @param {string} url - The URL pointing to the zip file.
 * @param {string} outputDir - The path to the directory where the contents of the zip file will be extracted.
 * @returns {Promise<void>} A Promise that resolves after successfully downloading and extracting the zip file.
 */
const downloadAndUnzip = async (url, outputDir) => {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
  })

  const zip = new AdmZip(response.data)
  zip.extractAllTo(outputDir, true)
}

/**
 * Initializes a Git repository at the specified path.
 *
 * @param {string} repoPath - The path where the Git repository will be initialized.
 * @returns {Promise<void>} A Promise that resolves after initializing the Git repository.
 */
const initializeGitRepo = async (repoPath) => {
  try {
    const git = simpleGit(repoPath)
    await git.init()
    console.log(`Initialized Git repository in ${repoPath}`)
  } catch (error) {
    console.error('Error initializing Git repository:', error.message)
  }
}

/**
 * Downloads and extracts the latest release of a GitHub repository, performing actions based on the provided 'action'.
 * - If 'action' is 'create', it creates a new project directory, initializes it with the downloaded content, sets up necessary configurations, and processes the downloaded files.
 * - If 'action' is other than 'update', it performs a sync.
 *
 * @param {string} name - The name of the project or directory to be created (if 'action' is 'create').
 * @param {string} [action='create'] - The action to be performed. Defaults to 'create'.
 * @returns {Promise<void>} A Promise that resolves after completing the download, extraction, and required actions.
 */
const downloadAndUnzipFromGithub = async (name, action = 'create') => {
  try {
    const tagsUrl =
      'https://api.github.com/repos/webapprobot/backendboilerplate/tags'
    const response = await axios.get(tagsUrl)

    if (response.data && response.data.length > 0) {
      const zipballUrl = response.data[0].zipball_url
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'github_download_'))
      await downloadAndUnzip(zipballUrl, tempDir)
      const dirs = fs.readdirSync(tempDir)
      const firstDir = dirs.find((item) =>
        fs.statSync(path.join(tempDir, item)).isDirectory()
      )
      if (firstDir) {
        if (action === 'create') {
          const backendrobotDir = path.join(process.cwd(), name)
          fs.ensureDirSync(backendrobotDir)
          fs.moveSync(
            path.join(tempDir, firstDir),
            path.join(backendrobotDir),
            {
              overwrite: true,
            }
          )
          await initializeGitRepo(path.join(backendrobotDir))
          // rename
          process.chdir(backendrobotDir)
          fs.copySync('.env.example', '.env')
          renameModuleName(name)
          await to(downloadFromDriveAndConvertToJson())
          await to(processModels())
          await to(processRoutes())
          // add : process routes
        } else {
          const files = fs.readdirSync(path.join(tempDir, firstDir))
          files.forEach((file) => {
            if (file !== '.gitignore') {
              const sourcePath = path.join(tempDir, firstDir, file)
              const destinationPath = path.join(process.cwd(), file)
              fs.copySync(sourcePath, destinationPath)
            }
          })
        }
      }
    } else {
      console.log('No tags found.')
    }
  } catch (error) {
    console.error('Error occurred:', error.message)
  }
}

/**
 * Renames files and directories within the deb 'etc' directory by replacing occurrences of the provided moduleName with newName.
 *
 * @param {string} moduleName - The name to be replaced within file and directory names.
 * @param {string} newName - The new name to replace the occurrences of moduleName.
 */
const renameEtcFiles = (moduleName, newName) => {
  try {
    let rootDir = path.join(process.cwd(), 'debData', 'etc')
    {
      const files = fs.readdirSync(rootDir)
      files.forEach((file) => {
        let newDirName = file.replace(moduleName, newName)
        fs.renameSync(path.join(rootDir, file), path.join(rootDir, newDirName))
      })
    }
    {
      const dirs = fs.readdirSync(rootDir)
      dirs.forEach((dir) => {
        const filePath = path.join(rootDir, dir)
        const files = fs.readdirSync(filePath)
        files.forEach((file) => {
          let newDirName = file.replace(moduleName, newName)
          fs.renameSync(
            path.join(rootDir, dir, file),
            path.join(rootDir, dir, newDirName)
          )
        })
      })
    }
  } catch (err) {
    console.error('Error reading directory:', err)
  }
}

/**
 * Creates a new application based on the specified type using provided arguments.
 *
 * @param {Object} args - The arguments required for the creation process, including the application type.
 * @param {Object} supplied - The supplied options containing the name of the application ('-n').
 * @returns {Promise<void>} A Promise that resolves once the new application creation process is completed.
 */
const create = async (args, supplied) => {
  let name = supplied['-n']
  let { type } = args
  switch (type) {
    case 'backend':
      {
        await createNewBackendApp(name)
      }
      break
    case 'frontend':
      break
  }
}

/**
 * Initiates the update process by downloading and unzipping files from a specified GitHub repository.
 *
 * @param {Object} args - The arguments required for the update process. (Currently not utilized)
 * @param {string} supplied - The supplied string used as a parameter for the update process. (Currently not utilized)
 * @returns {Promise<void>} A Promise that resolves once the update process, including downloading and unzipping from the GitHub repository, is completed.
 */
const update = async (args, supplied) => {
  await downloadAndUnzipFromGithub('', 'update')
}

/**
 * Creates variables based on the provided package name.
 *
 * @param {string} package_ - The name of the package.
 * @returns {Object} An object containing variables derived from the provided package name:
 *                    - 'packageCamelCase': The camelCase version of the package name.
 *                    - 'modelDir': The path to the model directory corresponding to the package.
 *                    - 'packageData': Data associated with the provided package name from modelsData.
 */
const createPackageVariables = (modelsData, package_) => {
  let packageCamelCase = _.camelCase(package_)
  let modelDir = path.join(process.cwd(), 'local-src', 'models', package_)
  let controllerDir = path.join(
    process.cwd(),
    'local-src',
    'controllers',
    package_
  )
  let persistentControllerDir = path.join(
    process.cwd(),
    'local-src',
    'persistent-controllers',
    package_
  )
  let routesDir = path.join(process.cwd(), 'local-src', 'routes', package_)
  let packageData = modelsData[package_]
  let packageTitleCase =
    packageCamelCase[0].toUpperCase() +
    packageCamelCase.slice(-(packageCamelCase.length - 1))
  // packageTitleCase[0] = packageTitleCase[0].toUpperCase()
  return {
    packageCamelCase,
    modelDir,
    controllerDir,
    routesDir,
    packageData,
    packageTitleCase,
    persistentControllerDir,
  }
}

/**
 * Creates variables based on the provided model and package data.
 *
 * @param {string} model - The name of the model.
 * @param {Object} packageData - Data associated with the package containing the model.
 * @returns {Object} An object containing variables derived from the provided model and package data:
 *                    - 'imports': An array to store import statements.
 *                    - 'modelCamelCase': The camelCase version of the model name.
 *                    - 'fields': Fields associated with the provided model from the package data.
 *                    - 'primary': A variable representing whether current field is a primary key field; initialized as 'false'.
 */
const createPackageDataVariables = (model, packageData) => {
  let imports = []
  let modelCamelCase = _.camelCase(model)
  let fields = packageData[model]
  let primary: any = false
  return { imports, modelCamelCase, fields, primary }
}

const processRoutes = async (supplied: any = false) => {
  let { d, debug } = supplied
  debug = debug || d
  let isDevEnv: boolean = debug
  let modelsData = readModelsData('routesFromModels.json')
  createControllersDirectories()
  let templateContent = readTemplateData('controllers')
  let modulePath = readModulePath()
  {
    // routes setup
    createRoutesDirectories()
  }
  for (const package_ of Object.keys(modelsData)) {
    let {
      packageCamelCase,
      packageTitleCase,
      controllerDir /*, routesDir*/,
      persistentControllerDir,
      packageData,
    } = createPackageVariables(modelsData, package_)

    {
      let routesDir = path.join(process.cwd(), 'local-src', 'systemRoutes')
      let routesTemplate = readTemplateData('route')
      let routeFile = path.join(routesDir, `${packageCamelCase}.go`)
      let models = {}
      let routeGroupsStrs = []
      let routesFuncTemplate = readTemplateData('routeFunc')
      for (const model of Object.keys(packageData)) {
        let { modelCamelCase /*, fields*/ } = createPackageDataVariables(
          model,
          packageData
        )
        let actions = Object.keys(packageData[model])
        models[model] = Object.keys(packageData[model])
        let codeActionNamesMaps = {
          create: 'Post',
          read: 'Get',
          update: 'Patch',
          delete: 'Delete',
        }
        actions.map((action) => {
          let actionTitleCase =
            action[0].toUpperCase() + action.slice(-(action.length - 1))
          let funcName = `${actionTitleCase}${model}`
          let funcNameStr = `${packageCamelCase}Controller.${actionTitleCase}${model}`
          // let funcNamePersistent = `${packageCamelCase}ControllerPersistent.${actionTitleCase}${model}`
          let actionStr = `${packageCamelCase}.${codeActionNamesMaps[action]}`
          let renderized = ejs.render(routesFuncTemplate, {
            package: packageCamelCase,
            modelCamelCase,
            packageTitleCase,
            routeGroupsStr,
            modulePath,
            funcName,
            funcNameStr,
            // funcNamePersistent,
            action: actionStr,
          })
          routeGroupsStrs.push(renderized)
        })
      }

      let routeGroupsStr = routeGroupsStrs.join('\n')

      console.log(models)
      let renderized = ejs.render(routesTemplate, {
        package: packageCamelCase,
        packageTitleCase,
        routeGroupsStr,
        modulePath,
      })
      fs.writeFileSync(routeFile, renderized, (err) => {
        if (err) {
          console.error('Error writing file:', err)
        }
      })
    }

    // persistent controllers
    let templateContentPersistent = readTemplateData(
      'emptyPersistentController'
    )
    for (const model of Object.keys(packageData)) {
      let { imports, modelCamelCase /*, fields*/ } = createPackageDataVariables(
        model,
        packageData
      )
      let renderized = ejs.render(templateContentPersistent, {
        package: packageCamelCase,
        modelCamelCase,
        modelTitleCase: model,
        imports,
        packageTitleCase,
        isDevEnv,
      })

      let controllerFile = path.join(
        persistentControllerDir,
        `${modelCamelCase}.go`
      )
      if (!fs.existsSync(controllerFile)) {
        // do not overwrite
        fs.writeFileSync(controllerFile, renderized, (err) => {
          if (err) {
            console.error('Error writing file:', err)
          }
        })
      }
    }
    for (const model of Object.keys(packageData)) {
      let { imports, modelCamelCase /*, fields*/ } = createPackageDataVariables(
        model,
        packageData
      )
      // let parentModel: any = false
      // for (let fieldKey in fields) {
      //   let { field /*type /*, typeFromTypes */ } = createFieldVariables(
      //     fields[fieldKey]
      //   )
      //   createRelationShips(fields, fieldKey, packageCamelCase, imports)
      //   updateField(fields, field, fieldKey, parentModel)
      // }
      // // parentModel.value = false
      // for (let fieldKey in fields) {
      //   let { field, type /*, typeFromTypes */ } = createFieldVariables(
      //     fields[fieldKey]
      //   )
      //   addToImports(type, imports)
      //   setDefaultFieldType(field)
      //   setPrimarykey(primary, fieldKey, field, imports)
      //   setDefaultValue(field)
      //   setFieldLength(field)
      //   setTimeType(field)
      //   setIntType(field)
      //   setFloatType(field)
      //   updateField(fields, field, fieldKey, parentModel)
      // }

      // console.log({ packageCamelCase, model , parentModel:parentModel})
      let renderized = ejs.render(templateContent, {
        package: packageCamelCase,
        modelCamelCase,
        modelTitleCase: model,
        // fields,
        // Primary: primary,
        imports,
        packageTitleCase,
        isDevEnv,
      })
      // correct modelFile name
      // console.log(renderized)

      let controllerFile = path.join(controllerDir, `${modelCamelCase}.go`)
      // if (!fs.existsSync(controllerFile)) { // overwrite afterall
      fs.writeFileSync(controllerFile, renderized, (err) => {
        if (err) {
          console.error('Error writing file:', err)
        }
      })
      // }
    }
  }
}

export {
  downloadFile,
  downloadFromDriveAndConvertToJson,
  xlsxToJSON,
  processModels,
  rename,
  create,
  update,
  processRoutes,
}
