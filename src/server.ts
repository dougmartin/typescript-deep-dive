// server.ts
import * as express from "express"
import * as path from "path"
import * as fs from "fs"

// API
interface Repo {
  name: string,
  folder: string
}

type APIResult = Repo[]

class API {
  baseRepoPath = path.resolve(path.join(__dirname, "../repos"))

  repos(callback: (error:string|null, repos?:Repo[]) => void) {
    fs.readdir(this.baseRepoPath, (error, files) => {
      if (error) {
        callback(error.toString())
      }
      else {
        callback(null, files.map<Repo>((filename) => {
          const basename = path.basename(filename, ".git")
          return {
            name: `${basename.substr(0, 1).toUpperCase()}${basename.substr(1)}`,
            folder: filename
          }
        }))
      }
    })
  }
}

// SERVER CREATION
const app = express()
const port = process.env.PORT || 3000
const api = new API()

// MIDDLEWARE

interface APIResponse extends express.Response {
  api(error:string, result?: APIResult): express.Response
}

app.use((req:express.Request, res:APIResponse, next:express.NextFunction) => {
  res.api = (error, result) => {
    res.setHeader("Content-Type", "application/json")
    if (error) {
      return res.json({success: false, error: error})
    }
    return res.json({success: true, result: result})
  }
  next()
})

// ROUTES

app.get("/", (req:express.Request, res:express.Response) => {
  res.send("Hello world!")
})

app.get("/api/", (req:express.Request, res:APIResponse) => {
  api.repos(res.api)
})

// SERVER STARTUP

app.listen(port, () => {
  console.log(`Started server on port ${port}`)
})

