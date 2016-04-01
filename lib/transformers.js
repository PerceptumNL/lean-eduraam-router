const util = require('util');
const Transform = require('stream').Transform;

util.inherits(InsertTransform, Transform);
function InsertTransform(insertion, order, lookout, options) {
  if (!(this instanceof InsertTransform))
    return new InsertTransform(insertion, order, lookout, options);

  options = options || {};
  options.decodeString = false;
  Transform.call(this, options);
  this.finished = false;
  this._insertion = Buffer(insertion);
  this._order = order;
  this._lookout = Buffer(lookout);
  this._lookout_length = this._lookout.length;
  this._lookout_index = 0;
}

InsertTransform.prototype._transform = function(chunk, encoding, done) {
  if (this.finished){
    // If the match has already been made, stop looking.
    done(null, chunk);
    return;
  } else {
    var match_begin = null;
	var match_end = null;
    for(var i = 0; i < chunk.length; i++){
      if(chunk[i] == this._lookout[this._lookout_index]){
        this._lookout_index++;
        if(match_begin === null){
          match_begin = i;
		}
        if(this._lookout_index == this._lookout_length){
          // Match completed, stop looking any further
          match_end = i;
          this.finished = true;
          break;
        }
      }else{
        if(this._lookout_index > 0){
          if( match_begin === null || ( this._lookout_index > 1 && match_begin == 0) ){
            // Match started before this chunk, we need to rectify
            this.push(this._lookout.slice(0, this._lookout_index));
          }
          this._lookout_index = 0;
          match_begin = null;
        }
      }
    }

    if( this._lookout_index == 0 ){
      // This chunk is not part of our match
      done(null, chunk);
      return;
    }

    if( match_begin !== null && match_begin > 0){
      // If we have a start of a match, in the middle of the chunk
      //  => send chunk up to that point
      this.push(chunk.slice(0, match_begin));
    }

    if( match_end !== null ){
      // If we completed the match, => send the insert and the match
      if( this._order === "before" ){ this.push(this._insertion); }
      this.push(this._lookout);
      if( this._order === "after" ){ this.push(this._insertion); }
    }

    if( match_end !== null && (match_end+1) < chunk.length ){
      // If there was a piece of the chunk after the match
      //  => send the remainder of the chunk
      this.push(chunk.slice(match_end+1));
    }
    done();
  }
};

exports.Insert = InsertTransform;
