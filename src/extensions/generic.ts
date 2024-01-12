import {downloadFromDriveAndConvertToJson, processModels, rename, create, update, processRoutes} from "../webapp"
import {to} from "await-to-js"

module.exports = (toolbox) => {
  toolbox.generic = async (supplied, args) => {
    let err, care;
    switch(args.action){
        case "downloadFromDriveToJson":
            [err, care] = await to(downloadFromDriveAndConvertToJson())
            if(err){
                return console.log(err)
            }
            if(!care && err)console.log(err)

            break;
        case "processModels":
            [err, care] = await to(processModels())
            if(err){
                return console.log(err)
            }
            if(!care && err)console.log(err)

            break;
        case "processRoutes":
            [err, care] = await to(processRoutes(supplied))
            if(err){
                return console.log(err)
            }
            if(!care && err)console.log(err)

            break;
        case "rename":
            [err, care] = await to(rename(args, supplied))
            if(err){
                return console.log(err)
            }
            if(!care && err)console.log(err)

            break;
        case "create":
            [err, care] = await to(create(args, supplied))
            if(err){
                return console.log(err)
            }
            if(!care && err)console.log(err)
            break;
        case "update":
            [err, care] = await to(update(args, supplied))
            if(err){
                return console.log(err)
            }
            if(!care && err)console.log(err)
            break;
    }
  }
}
