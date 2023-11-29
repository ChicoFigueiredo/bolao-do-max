FROM node:14

# Create app directory
#WORKDIR /usr/src/app

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY ./bolao-max-server/package*.json ./

RUN npm install
# If you are building your code for production
RUN npm ci --only=production

# Bundle app source
COPY ./bolao-max-server/ ./
COPY --chown=node:node ./bolao-max-server/ ./

EXPOSE 8080-8085
EXPOSE 3000


#CMD "cd /home/node/app/ && node /home/node/app/bin/www"

CMD [ "cd /home/node/app/" ]
CMD [ "node", "/home/node/app/bin/www" ]
#CMD [ "/bin/bash" ]
#CMD "/bin/bash"
#CMD ["/bin/bash", "-c", "while true; do sleep 1000; done;"]

